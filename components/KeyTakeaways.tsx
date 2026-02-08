export default function KeyTakeaways({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl bg-amber-50 p-6">
      <h2 className="text-lg font-semibold text-amber-800">Key Takeaways</h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-warm-700">
            <span className="mt-0.5 text-amber-500">&#10003;</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
