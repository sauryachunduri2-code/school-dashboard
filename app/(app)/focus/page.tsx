"use client";

import { Suspense } from "react";
import { FocusScreen } from "@/components/focus/focus-screen";

export default function FocusPage() {
  return (
    <Suspense fallback={null}>
      <FocusScreen />
    </Suspense>
  );
}
