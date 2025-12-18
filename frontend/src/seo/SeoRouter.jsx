import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applySeo } from './domSeo';
import { resolveRouteSeo } from './routes';

export default function SeoRouter() {
  const location = useLocation();

  useEffect(() => {
    const resolved = resolveRouteSeo(location.pathname);
    applySeo({
      title: resolved.title,
      description: resolved.description,
      keywords: resolved.keywords,
      canonicalPath: resolved.canonicalPath || location.pathname,
      robots: resolved.robots,
      ogType: resolved.ogType,
      imagePath: resolved.imagePath,
      jsonLd: resolved.jsonLd,
    });
  }, [location.pathname]);

  return null;
}

