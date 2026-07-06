"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { UserRound } from "lucide-react";

export function ProfileAvatarImage({
  src,
  fallbackSrc,
  alt = "",
  width,
  height,
  sizes,
  iconSize,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  alt?: string;
  width: number;
  height: number;
  sizes: string;
  iconSize: number;
}) {
  const candidates = useMemo(() => {
    const unique = new Set<string>();
    for (const candidate of [src, fallbackSrc]) {
      const trimmed = candidate?.trim();
      if (trimmed) unique.add(trimmed);
    }
    return [...unique];
  }, [src, fallbackSrc]);
  const candidateKey = candidates.join("\n");
  const [failureState, setFailureState] = useState<{ candidateKey: string; failedSrcs: string[] }>({
    candidateKey: "",
    failedSrcs: [],
  });

  const failedSrcs = failureState.candidateKey === candidateKey ? failureState.failedSrcs : [];
  const activeSrc = candidates.find((candidate) => !failedSrcs.includes(candidate));
  if (!activeSrc) return <UserRound size={iconSize} aria-hidden="true" />;

  return (
    <Image
      key={activeSrc}
      src={activeSrc}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      unoptimized
      onError={() =>
        setFailureState((current) => {
          const currentFailed = current.candidateKey === candidateKey ? current.failedSrcs : [];
          if (currentFailed.includes(activeSrc)) return { candidateKey, failedSrcs: currentFailed };
          return { candidateKey, failedSrcs: [...currentFailed, activeSrc] };
        })
      }
    />
  );
}
