import type { GuideHub } from "@/lib/types";

export default function NeighbourhoodHistory({ data }: { data: GuideHub }) {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold text-warm-800">
        History of Liberty Village
      </h2>
      {data.history.split("\n").filter(Boolean).map((para, i) => (
        <p key={i} className="mt-3 text-warm-600 leading-relaxed">
          {para}
        </p>
      ))}

      {(data.prosCons.pros.length > 0 || data.prosCons.cons.length > 0) && (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {data.prosCons.pros.length > 0 && (
            <div className="rounded-lg bg-sage-50 p-5">
              <h3 className="font-semibold text-sage-800">Pros</h3>
              <ul className="mt-3 space-y-2">
                {data.prosCons.pros.map((pro) => (
                  <li key={pro} className="flex gap-2 text-sm text-warm-700">
                    <span className="text-sage-500">+</span>
                    {pro}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.prosCons.cons.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-5">
              <h3 className="font-semibold text-amber-800">Cons</h3>
              <ul className="mt-3 space-y-2">
                {data.prosCons.cons.map((con) => (
                  <li key={con} className="flex gap-2 text-sm text-warm-700">
                    <span className="text-amber-500">&minus;</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
