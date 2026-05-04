export function MarmotStage() {
  return (
    <div className="relative mx-auto aspect-[5/6] w-full max-w-[420px] lg:mx-0 lg:max-w-[480px]">
      <div className="absolute inset-0 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)]" />

      <img
        src="/marmot.webp"
        alt="A friendly illustrated marmot, sitting upright with paws together."
        className="absolute inset-x-0 bottom-0 mx-auto h-[92%] w-auto select-none"
        draggable={false}
        loading="eager"
      />

    </div>
  );
}
