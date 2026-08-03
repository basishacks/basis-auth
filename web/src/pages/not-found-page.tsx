import { ArrowLeft01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Page not found</CardTitle>
          <CardDescription>The page you requested does not exist or has moved.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            <HugeiconsIcon icon={Search01Icon} size={20} aria-hidden="true" className="text-primary" />
            Check the address or return to Basis Auth.
          </div>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link to="/">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={18} aria-hidden="true" />
              Return home
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
