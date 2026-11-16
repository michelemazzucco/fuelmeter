"use client"

import { PaperBox } from "@/components/paper"
import { SettingsForm } from "@/components/settings-form"

export default function SettingsPage() {
  return (
    <div className="max-w-md">
      <h1 className="sr-only">Settings</h1>
      <PaperBox label="Tank configuration">
        <SettingsForm />
      </PaperBox>
    </div>
  )
}
