import Image from "next/image";

interface HeroImageProps {
  src?: string;
  alt: string;
  children?: React.ReactNode;
}

export default function HeroImage({ src, alt, children }: HeroImageProps) {
  if (!src) return null;

  return (
    <div className="relative mb-8 overflow-hidden rounded-xl aspect-[16/9] sm:aspect-[16/9]">
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover"
        priority
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 896px"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
      {children && (
        <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
          {children}
        </div>
      )}
    </div>
  );
}
