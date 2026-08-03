import { ArrowRight01Icon, SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Badge variant="secondary" className="w-fit">Basis Auth</Badge>
          <CardTitle className="mt-3 text-2xl">Identity starts here.</CardTitle>
          <CardDescription>A minimal Vite, Radix, and shadcn/ui starter page.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            <HugeiconsIcon icon={SecurityCheckIcon} size={20} aria-hidden="true" className="text-primary" />
            Ready for your authorization and interaction screens.
          </div>
        </CardContent>
        <CardFooter>
          <Button className="w-full">
            Get started
            <HugeiconsIcon icon={ArrowRight01Icon} size={18} aria-hidden="true" />
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
