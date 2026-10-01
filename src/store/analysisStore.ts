import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Aggregation,
  AnalysisConfig,
  ChartType,
  DropZoneId,
  FilterCondition,
  PivotField,
  SavedView,
  ValueField,
} from "@/types/analysis";
import type { DimensionKey, FieldKey, MetricKey } from "@/types/report";
import { makeId } from "@/lib/utils";

const DEFAULT_CONFIG: AnalysisConfig = {
  rows: [{ id: "row_default", dimension: "ttAccountName" }],
  columns: [],
  values: [{ id: "val_default", metric: "grossRevenue", aggregation: "SUM" }],
  filters: [],
  chartType: "table",
};

interface AnalysisState {
  rows: PivotField[];
  columns: PivotField[];
  values: ValueField[];
  filters: FilterCondition[];
  chartType: ChartType;
  /** Which value field the chart plots; charts show one metric at a time. */
  chartValueId: string | null;
  savedViews: SavedView[];
  activeViewId: string | null;

  addField: (zone: DropZoneId, key: DimensionKey | MetricKey) => void;
  removeField: (zone: DropZoneId, id: string) => void;
  moveField: (from: DropZoneId, to: DropZoneId, id: string) => void;
  reorderField: (zone: DropZoneId, fromIndex: number, toIndex: number) => void;
  setAggregation: (id: string, aggregation: Aggregation) => void;

  addFilter: (field: FieldKey) => void;
  updateFilter: (id: string, patch: Partial<Omit<FilterCondition, "id">>) => void;
  removeFilter: (id: string) => void;

  setChartType: (chartType: ChartType) => void;
  setChartValueId: (id: string | null) => void;

  getConfig: () => AnalysisConfig;
  applyConfig: (config: AnalysisConfig) => void;
  reset: () => void;

  saveView: (name: string) => SavedView;
  deleteView: (id: string) => void;
  loadView: (id: string) => void;
}

/** Dimension zones hold each field once; a pivot grouped twice by Creator is a no-op. */
function withoutDimension(fields: PivotField[], dimension: DimensionKey): PivotField[] {
  return fields.filter((field) => field.dimension !== dimension);
}

export const useAnalysisStore = create<AnalysisState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_CONFIG,
      chartValueId: DEFAULT_CONFIG.values[0]?.id ?? null,
      savedViews: [],
      activeViewId: null,

      addField: (zone, key) =>
        set((state) => {
          if (zone === "values") {
            const value: ValueField = { id: makeId("val"), metric: key as MetricKey, aggregation: "SUM" };
            return {
              values: [...state.values, value],
              chartValueId: state.chartValueId ?? value.id,
            };
          }

          const dimension = key as DimensionKey;
          const field: PivotField = { id: makeId(zone), dimension };
          // A dimension can only live in one zone; dropping it into the other moves it.
          return zone === "rows"
            ? {
                rows: [...withoutDimension(state.rows, dimension), field],
                columns: withoutDimension(state.columns, dimension),
              }
            : {
                columns: [...withoutDimension(state.columns, dimension), field],
                rows: withoutDimension(state.rows, dimension),
              };
        }),

      removeField: (zone, id) =>
        set((state) => {
          if (zone === "values") {
            const values = state.values.filter((v) => v.id !== id);
            return {
              values,
              chartValueId: state.chartValueId === id ? (values[0]?.id ?? null) : state.chartValueId,
            };
          }
          return zone === "rows"
            ? { rows: state.rows.filter((f) => f.id !== id) }
            : { columns: state.columns.filter((f) => f.id !== id) };
        }),

      moveField: (from, to, id) =>
        set((state) => {
          if (from === to) return {};
          // Values and dimensions are different kinds of thing
          if (from === "values" || to === "values") return {};

          const source = from === "rows" ? state.rows : state.columns;
          const field = source.find((f) => f.id === id);
          if (!field) return {};

          const remaining = source.filter((f) => f.id !== id);
          return from === "rows"
            ? { rows: remaining, columns: [...withoutDimension(state.columns, field.dimension), field] }
            : { columns: remaining, rows: [...withoutDimension(state.rows, field.dimension), field] };
        }),

      reorderField: (zone, fromIndex, toIndex) =>
        set((state) => {
          const source =
            zone === "rows" ? state.rows : zone === "columns" ? state.columns : state.values;
          if (fromIndex === toIndex) return {};
          if (fromIndex < 0 || fromIndex >= source.length) return {};
          if (toIndex < 0 || toIndex >= source.length) return {};

          const next = [...source];
          const [moved] = next.splice(fromIndex, 1);
          if (!moved) return {};
          next.splice(toIndex, 0, moved);

          if (zone === "rows") return { rows: next as PivotField[] };
          if (zone === "columns") return { columns: next as PivotField[] };
          return { values: next as ValueField[] };
        }),

      setAggregation: (id, aggregation) =>
        set((state) => ({
          values: state.values.map((v) => (v.id === id ? { ...v, aggregation } : v)),
        })),

      addFilter: (field) =>
        set((state) => ({
          filters: [...state.filters, { id: makeId("flt"), field, operator: "gt", value: null }],
        })),

      updateFilter: (id, patch) =>
        set((state) => ({
          filters: state.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),

      removeFilter: (id) => set((state) => ({ filters: state.filters.filter((f) => f.id !== id) })),

      setChartType: (chartType) => set({ chartType }),
      setChartValueId: (chartValueId) => set({ chartValueId }),

      getConfig: () => {
        const { rows, columns, values, filters, chartType } = get();
        return { rows, columns, values, filters, chartType };
      },

      applyConfig: (config) =>
        set({
          rows: config.rows,
          columns: config.columns,
          values: config.values,
          filters: config.filters,
          chartType: config.chartType,
          chartValueId: config.values[0]?.id ?? null,
        }),

      reset: () =>
        set({
          ...DEFAULT_CONFIG,
          chartValueId: DEFAULT_CONFIG.values[0]?.id ?? null,
          activeViewId: null,
        }),

      saveView: (name) => {
        const now = new Date().toISOString();
        const existing = get().savedViews.find((view) => view.name === name);
        const view: SavedView = {
          id: existing?.id ?? makeId("view"),
          name,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          config: get().getConfig(),
        };

        set((state) => ({
          savedViews: existing
            ? state.savedViews.map((v) => (v.id === view.id ? view : v))
            : [...state.savedViews, view],
          activeViewId: view.id,
        }));

        return view;
      },

      deleteView: (id) =>
        set((state) => ({
          savedViews: state.savedViews.filter((view) => view.id !== id),
          activeViewId: state.activeViewId === id ? null : state.activeViewId,
        })),

      loadView: (id) => {
        const view = get().savedViews.find((v) => v.id === id);
        if (!view) return;
        get().applyConfig(view.config);
        set({ activeViewId: id });
      },
    }),
    {
      name: "gmv-max-analysis",
      version: 1,
      partialize: (state) => ({ savedViews: state.savedViews }),
    },
  ),
);
