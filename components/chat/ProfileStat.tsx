export function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspir-profile-stat">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
