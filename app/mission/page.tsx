import { ContentPage } from "@/components/legal/ContentPage";
import { extractedPages } from "@/lib/content/extracted-pages";

const missionImages = [
  "//5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191905644x747393734386347000/inspire-logo-presentation_compressed_page-0008.jpg",
  "//5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191915410x254612906062515970/inspire-logo-presentation_compressed_page-0007.jpg",
  "//5ee5b6e1ce35d6eb5c13bd01a3187ca0.cdn.bubble.io/f1685191628192x310335032442042600/inspire-logo-presentation_compressed_page-0009.jpg",
] as const;

export default function MissionPage() {
  return (
    <ContentPage
      title="inspir - Learning is for everyone"
      blocks={extractedPages.mission}
      images={missionImages}
    />
  );
}
