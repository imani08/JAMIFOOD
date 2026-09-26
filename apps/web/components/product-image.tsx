'use client';
import { useState } from 'react';
import { productImageUrl } from '../lib/product-image';
export function ProductImage({ value, name }: { value?: string | null; name: string }) {
  const src = productImageUrl(value);
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(src)} style={{width:120,height:90,maxWidth:'100%',objectFit:'cover',borderRadius:8}} /> : <span className="muted" role="img" aria-label={`Image indisponible : ${name}`}>Image indisponible</span>;
}
