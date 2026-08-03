import { useParams } from "react-router-dom";

export function InteractionPage() {
  const { uid } = useParams();

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <p className="text-sm text-muted-foreground">Interaction {uid}</p>
    </main>
  );
}
