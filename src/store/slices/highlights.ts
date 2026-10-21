import type { StateCreator } from 'zustand';
import type { Highlight } from '../../types';
import { levelText } from '../../lib/ladder';
import type { StoreState, HighlightSlice } from '../types';

export const createHighlightSlice: StateCreator<StoreState, [], [], HighlightSlice> = (set, get) => ({
  addHighlight: (nodeId: string, highlight: Highlight) => {
    get().pushHistory();
    get().logEvent('highlight-add', nodeId, { chars: highlight.text.length });
    // Normalize: collapse whitespace/newlines to single space
    const normalizedHighlight = { at: new Date().toISOString(), ...highlight, text: highlight.text.replace(/\s+/g, ' ').trim() };
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, highlights: [...n.data.highlights, normalizedHighlight] } }
          : n
      ),
    }));
    get().pushHistory();
  },

  removeHighlight: (nodeId: string, highlightId: string) => {
    get().pushHistory();
    get().logEvent('highlight-remove', nodeId);
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, highlights: n.data.highlights.filter((h) => h.id !== highlightId) } }
          : n
      ),
    }));
    get().pushHistory();
  },

  setHighlightMode: (nodeId: string, mode: 'off' | 'tag' | 'filter') => {
    // 'filter' changes what downstream reads: a step
    get().pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, highlightMode: mode } } : n
      ),
    }));
    get().pushHistory();
  },

  // Material nodes (file / note / link) have no responses[] to index into —
  // their one summary lives at slot 0, unconditionally.
  setMaterialSummary: (nodeId: string, summary: string, topic?: string) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, summaries: [summary], summaryTypes: ['insight'], summaryTopics: [topic] } }
          : n,
      ),
    }));
  },

  setSummary: (nodeId: string, summary: string, forResponse: string, type?: string, topic?: string, confidence?: number, conclusive?: number) => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const idx = n.data.responses.indexOf(forResponse);
        if (idx === -1) return n; // the version was edited/deleted meanwhile
        const summaries = [...(n.data.summaries ?? [])];
        summaries[idx] = summary;
        const summaryTypes = [...(n.data.summaryTypes ?? [])];
        summaryTypes[idx] = type ?? 'insight';
        const summaryTopics = [...(n.data.summaryTopics ?? [])];
        summaryTopics[idx] = topic;
        const summaryTypeConfidences = [...(n.data.summaryTypeConfidences ?? [])];
        summaryTypeConfidences[idx] = confidence;
        const summaryConclusiveness = [...(n.data.summaryConclusiveness ?? [])];
        summaryConclusiveness[idx] = conclusive;
        return { ...n, data: { ...n.data, summaries, summaryTypes, summaryTopics, summaryTypeConfidences, summaryConclusiveness } };
      }),
    }));
  },

  setLadder: (nodeId, forResponse, ladder) => {
    set((state) => ({
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const idx = n.data.responses.indexOf(forResponse);
        if (idx === -1) return n;
        const summaryLadders = [...(n.data.summaryLadders ?? [])];
        summaryLadders[idx] = ladder;
        if (!ladder) return { ...n, data: { ...n.data, summaryLadders } };
        // the plain texts every other surface reads come from the ladder too, so the two never disagree
        const summaries = [...(n.data.summaries ?? [])]; summaries[idx] = levelText(ladder, 1);
        const summaryTopics = [...(n.data.summaryTopics ?? [])]; summaryTopics[idx] = levelText(ladder, 0);
        return { ...n, data: { ...n.data, summaryLadders, summaries, summaryTopics } };
      }),
    }));
  },
});
