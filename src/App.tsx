import { useState, type FormEvent } from "react"
import { ArrowRight, Info, Route } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"

function App() {
  const [readyAt, setReadyAt] = useState("")
  const [budget, setBudget] = useState("")
  const [notice, setNotice] = useState("")

  function compareOptions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setNotice("Comparisons are not connected yet. No schedules, prices, or availability have been checked.")
  }

  function trySyntheticExample() {
    setReadyAt("2026-11-05T19:30")
    setBudget("150")
    setNotice("Synthetic example loaded: one adult ready at Boston Logan at 7:30 pm on November 5, 2026, with a $150 budget. These are sample trip details only; no availability has been checked.")
  }

  return (
    <>
      <a href="#trip-form" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:p-3">Skip to trip details</a>
      <header className="border-b border-t-4 border-t-[#153247] bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-base font-semibold tracking-tight">Travel recovery companion</p>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-[#166534]">Guest mode</Badge>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Sign in to save</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Saving trips is not available yet</DialogTitle>
                  <DialogDescription>Account features are not connected. You can explore the planner as a guest without signing in.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild><Button>Continue as guest</Button></DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <div className="mb-7 max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Boston to Portland recovery planner</h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">A delayed San Diego–Boston flight meant missing every train to Portland and driving instead. Start with when you can leave Boston Logan.</p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)]">
          <Card className="rounded-lg shadow-none [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
            <CardHeader className="border-b">
              <h2 id="trip-heading" className="text-lg font-semibold">Your onward trip</h2>
              <CardDescription>One adult, Boston Logan to Portland, Maine.</CardDescription>
            </CardHeader>
            <CardContent>
              <form id="trip-form" aria-labelledby="trip-heading" onSubmit={compareOptions}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="origin">Leaving from</FieldLabel>
                    <Input id="origin" name="origin" value="Boston Logan (BOS)" readOnly />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="destination">Going to</FieldLabel>
                    <Input id="destination" name="destination" value="Portland, Maine" readOnly />
                    <FieldDescription>This prototype covers this corridor only.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ready-at">Ready to leave Logan at</FieldLabel>
                    <Input id="ready-at" name="readyAt" type="datetime-local" required value={readyAt} onChange={(event) => { setReadyAt(event.target.value); setNotice("") }} aria-describedby="ready-at-help" />
                    <FieldDescription id="ready-at-help">Local Boston time (America/New_York). Allow time for bags and leaving the terminal.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="travelers">Travelers</FieldLabel>
                    <NativeSelect id="travelers" name="travelers" defaultValue="1" className="w-full">
                      <NativeSelectOption value="1">1 adult</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="budget">Maximum budget (USD, optional)</FieldLabel>
                    <Input id="budget" name="budget" type="number" min="0" step="1" inputMode="numeric" placeholder="For example, 150" value={budget} onChange={(event) => { setBudget(event.target.value); setNotice("") }} />
                  </Field>
                  <div className="grid gap-2">
                    <Button type="submit" className="w-full">Compare recovery options</Button>
                    <Button type="button" variant="outline" onClick={trySyntheticExample} className="w-full">Try synthetic example</Button>
                    <p className="text-xs leading-relaxed text-muted-foreground">The synthetic example uses sample trip details, not live transport inventory.</p>
                  </div>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-6">
            <section aria-labelledby="options-heading" className="overflow-hidden rounded-lg border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5 sm:px-6">
                <h2 id="options-heading" className="text-lg font-semibold">Recovery options</h2>
                <Badge variant="outline" className="border-[#B45309]/30 text-[#B45309]">No availability checked</Badge>
              </div>
              <div className="px-5 py-6 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium">
                  <span>Boston Logan (BOS)</span><ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" /><span>Portland, Maine</span>
                </div>
                <Separator className="my-6" />
                <div className="flex items-start gap-4 py-5 sm:py-10">
                  <Route className="mt-1 size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="max-w-lg">
                    <h3 className="font-semibold">Your options will appear here</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Enter your trip details to prepare a comparison of onward transport. You can also load the clearly labeled synthetic example.</p>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">No timetables, fares, or seats have been retrieved.</p>
                  </div>
                </div>
              </div>
            </section>

            <div aria-live="polite" aria-atomic="true">
              {notice && (
                <Alert className="border-[#B45309]/30 bg-white">
                  <Info aria-hidden="true" className="text-[#B45309]" />
                  <AlertTitle>Planner preview</AlertTitle>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}
            </div>

            <section aria-labelledby="itinerary-heading" className="rounded-lg border bg-white px-5 py-5 sm:px-6">
              <h2 id="itinerary-heading" className="text-lg font-semibold">Selected itinerary</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">No itinerary selected. Once comparisons are available, choose an option to review its steps and connection times here.</p>
            </section>
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">Always confirm current schedules, prices, and availability with the operator before booking. This prototype cannot make purchases.</p>
          </div>
        </div>
      </main>
    </>
  )
}

export default App
