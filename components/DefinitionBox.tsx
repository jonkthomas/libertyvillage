export default function DefinitionBox({
  term,
  definition,
}: {
  term: string;
  definition: string;
}) {
  return (
    <aside className="rounded-lg border-l-4 border-sage-400 bg-sage-50 px-5 py-4">
      <dt className="text-sm font-semibold text-sage-600">{term}</dt>
      <dd className="mt-1 text-sm text-warm-600 leading-relaxed">{definition}</dd>
    </aside>
  );
}
