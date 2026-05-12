export type ColumnDef<K extends string> = {
  key: K;
  label: string;
  always?: boolean;
  defaultVisible?: boolean;
  num?: boolean;
};

export type VisibleMap<K extends string> = Record<K, boolean>;

export function computeDefaults<K extends string>(cols: readonly ColumnDef<K>[]): VisibleMap<K> {
  const m = {} as VisibleMap<K>;

  for (const c of cols) {
    m[c.key] = c.always || c.defaultVisible !== false;
  }

  return m;
}
