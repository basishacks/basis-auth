import { cn } from "@/lib/utils"

import { LoaderCircle, LoaderIcon } from "lucide-react"

function Spinner({ className, ...props }: Omit<React.ComponentProps<"svg">, "strokeWidth">) {
  return (
    <LoaderCircle
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
