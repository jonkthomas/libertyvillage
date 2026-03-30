import type { GuideHub } from "@/lib/types";

export default function NeighbourhoodFacts({ data }: { data: GuideHub }) {
  return (
    <div className="rounded-xl border border-warm-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-warm-800">Quick Facts</h2>

      <div className="mt-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-warm-500">Population</span>
          <span className="font-medium text-warm-800">{data.population}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-warm-500">Median Rent (1BR)</span>
          <span className="font-medium text-warm-800">{data.medianRent}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-warm-500">Walk Score</span>
          <span className="font-medium text-warm-800">{data.walkScore}/100</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-warm-500">Transit Score</span>
          <span className="font-medium text-warm-800">{data.transitScore}/100</span>
        </div>
      </div>

      <div className="mt-4 border-t border-warm-100 pt-4">
        <h3 className="text-sm font-medium text-warm-700">Boundaries</h3>
        <p className="mt-1 text-sm text-warm-500">{data.boundaries}</p>
      </div>

      {data.quickFacts.length > 0 && (
        <div className="mt-4 border-t border-warm-100 pt-4 space-y-2">
          {data.quickFacts.map((fact) => (
            <div key={fact.label} className="flex justify-between text-sm">
              <span className="text-warm-500">{fact.label}</span>
              <span className="font-medium text-warm-800 text-right max-w-[60%]">{fact.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
