interface ComparisonRow {
  label: string;
  lv: string | number;
  them: string | number;
}

export default function ComparisonTable({
  neighborhoodName,
  rows,
}: {
  neighborhoodName: string;
  rows: ComparisonRow[];
}) {
  return (
    <div className="overflow-x-auto">
      {/* Desktop table */}
      <table className="hidden w-full sm:table">
        <thead>
          <tr className="border-b border-warm-200">
            <th className="px-4 py-3 text-left text-sm font-medium text-warm-500">
              Category
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium text-amber-700 bg-amber-50 rounded-tl-lg">
              Liberty Village
            </th>
            <th className="px-4 py-3 text-left text-sm font-medium text-warm-700">
              {neighborhoodName}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-warm-100">
              <td className="px-4 py-3 text-sm font-medium text-warm-700">
                {row.label}
              </td>
              <td className="px-4 py-3 text-sm text-warm-800 bg-amber-50/50">
                {row.lv}
              </td>
              <td className="px-4 py-3 text-sm text-warm-800">{row.them}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <div
            key={row.label}
            className="rounded-lg border border-warm-200 bg-white p-3"
          >
            <span className="block text-xs font-medium text-warm-500 uppercase tracking-wide">
              {row.label}
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-amber-50 p-2">
                <span className="block text-xs text-amber-700">Liberty Village</span>
                <span className="text-sm font-medium text-warm-800">{row.lv}</span>
              </div>
              <div className="rounded-md bg-warm-50 p-2">
                <span className="block text-xs text-warm-600">{neighborhoodName}</span>
                <span className="text-sm font-medium text-warm-800">{row.them}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
