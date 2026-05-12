import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Column } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./data-table-column-header";

type Sorted = false | "asc" | "desc";

function makeColumn({
  canSort = true,
  sorted = false as Sorted,
}: {
  canSort?: boolean;
  sorted?: Sorted;
} = {}): Column<unknown, unknown> {
  const column = {
    getCanSort: () => canSort,
    getIsSorted: () => sorted,
    toggleSorting: () => {},
    clearSorting: () => {},
  };
  return column as unknown as Column<unknown, unknown>;
}

describe("DataTableColumnHeader", () => {
  it("renders left-aligned by default on a sortable column", () => {
    const html = renderToStaticMarkup(
      <DataTableColumnHeader column={makeColumn()} title="Instrument" />,
    );
    expect(html).not.toContain("flex justify-end");
    expect(html).toContain("-ml-1.5");
    expect(html).not.toContain("-mr-1.5");
  });

  it("renders right-aligned wrapper when align=right on a sortable column", () => {
    const html = renderToStaticMarkup(
      <DataTableColumnHeader column={makeColumn()} title="Quantité" align="right" />,
    );
    expect(html).toContain("flex justify-end");
    expect(html).toContain("-mr-1.5");
    expect(html).not.toContain("-ml-1.5");
  });

  it("renders text-right div with no sort button when align=right on a non-sortable column", () => {
    const html = renderToStaticMarkup(
      <DataTableColumnHeader
        column={makeColumn({ canSort: false })}
        title="Support"
        align="right"
      />,
    );
    expect(html).toContain("text-right");
    expect(html).not.toContain('data-slot="button"');
  });
});
