import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

interface ProfileData {
  name: string | null;
  email: string;
  picture: string | null;
}

export function Profile({ disabled, onLogout }: { disabled?: boolean; onLogout: () => void }) {
  const [profile, setProfile] = useState<ProfileData>();

  useEffect(() => {
    let active = true;
    void fetch("/api/me")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((value: ProfileData | undefined) => {
        if (active) setProfile(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!profile) return null;

  return (
    <Card className="w-full [--card-spacing:--spacing(2)]">
      <CardContent className="flex items-center gap-2 px-2">
        {profile.picture ? (
          <img
            src={profile.picture}
            alt=""
            className="size-7 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {profile.name?.slice(0, 1) ?? "?"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Label className="truncate text-xs font-bold">{profile.name ?? "Unknown user"}</Label>
          <Label className="truncate text-[10px] text-muted-foreground">{profile.email}</Label>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Sign out"
          disabled={disabled}
          onClick={onLogout}
        >
          {disabled ? <Spinner className="size-3" /> : <LogOut className="size-3" />}
        </Button>
      </CardContent>
    </Card>
  );
}
