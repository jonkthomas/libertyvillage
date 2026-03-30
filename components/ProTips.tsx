export default function ProTips({ tips }: { tips?: string[] }) {
  if (!tips || tips.length === 0) return null;

  return (
    <div className="pro-tips rounded-lg border-l-4 border-sage-400 bg-sage-50 p-6">
      <h2 className="mb-4 text-lg font-semibold text-warm-800">Pro Tips</h2>
      <ol className="space-y-3">
        {tips.map((tip, i) => (
          <li key={i} className="flex gap-3 text-sm text-warm-700">
            <span className="flex-shrink-0 text-base" aria-hidden="true">
              💡
            </span>
            <span>
              <strong className="text-warm-800">{i + 1}.</strong> {tip}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
