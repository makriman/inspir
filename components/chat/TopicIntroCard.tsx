export function TopicIntroCard({
  category,
  name,
  description,
}: {
  category: string;
  name: string;
  description: string;
}) {
  return (
    <article className="inspir-intro-card">
      <div>
        <span>{category}</span>
        <h2>{name}</h2>
      </div>
      <p>{description}</p>
    </article>
  );
}
