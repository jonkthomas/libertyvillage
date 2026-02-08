export default function AnswerBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="answer-block mt-4 rounded-xl border border-amber-200 bg-amber-50/60 px-6 py-5">
      <p className="text-base leading-relaxed text-warm-800">{children}</p>
    </div>
  );
}
