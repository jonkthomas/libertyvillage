export default function ServiceComparisonTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Record<string, string>>;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      {/* Desktop table */}
      <table className="hidden w-full md:table">
        <thead>
          <tr className="border-b border-warm-200">
            {columns.map((col) => (
              <th
                key={col}
                scope="col"
                className="px-4 py-3 text-left text-sm font-medium text-warm-500"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-warm-100 ${i % 2 === 1 ? "bg-warm-50/50" : ""}`}
            >
              {columns.map((col) => (
                <td key={col} className="px-4 py-3 text-sm text-warm-800">
                  {row[col] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile stacked cards */}
      <div className="space-y-3 md:hidden">
        {rows.map((row, i) => (
          <div
            key={i}
            className="rounded-lg border border-warm-200 bg-white p-4"
          >
            <span className="block text-sm font-semibold text-warm-800">
              {row[columns[0]] ?? ""}
            </span>
            <div className="mt-2 space-y-1">
              {columns.slice(1).map((col) => (
                <div key={col} className="flex justify-between text-sm">
                  <span className="text-warm-500">{col}</span>
                  <span className="text-warm-800">{row[col] ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
