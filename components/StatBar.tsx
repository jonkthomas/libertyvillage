export default function StatBar({
  stats,
}: {
  stats: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap justify-center gap-6 rounded-xl bg-warm-50 px-6 py-5 sm:gap-10">
      {stats.map((stat) => (
        <div key={stat.label} className="text-center">
          <span className="block text-2xl font-bold text-amber-600">
            {stat.value}
          </span>
          <span className="text-sm text-warm-500">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
