import { useEffect, useId, useRef, useState } from "react";
import type { City } from "@domain/city-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchCityCatalog } from "./citySearch";
export const cityLabel = (city: City) =>
  `${city.name}, ${city.stateCode}${city.countyName ? ` · ${city.countyName}` : ""}`;
export function CityPicker({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: City | null;
  onChange: (city: City | null) => void;
  error?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState(value ? cityLabel(value) : "");
  const [cities, setCities] = useState<City[]>([]);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const generation = useRef(0);
  const previousLabel = useRef(value ? cityLabel(value) : "");
  useEffect(() => {
    const next = value ? cityLabel(value) : "";
    setQuery((current) =>
      value ? next : current === previousLabel.current ? "" : current,
    );
    previousLabel.current = next;
    setCities([]);
    setOpen(false);
    generation.current++;
  }, [value]);
  useEffect(() => {
    if (value || query.trim().length < 2) {
      setCities([]);
      setStatus("");
      return;
    }
    const current = ++generation.current;
    setStatus("Searching cities…");
    const timer = setTimeout(() => {
      void searchCityCatalog(query)
        .then((results) => {
          if (generation.current !== current) return;
          setCities(results);
          setActive(-1);
          setOpen(true);
          setStatus(
            results.length
              ? ""
              : `No cities found. Try the city name with its state or county.`,
          );
        })
        .catch(() => {
          if (generation.current === current) {
            setCities([]);
            setStatus("City search is unavailable. Edit your search to retry.");
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [query, value]);
  function choose(city: City) {
    generation.current++;
    onChange(city);
    setQuery(cityLabel(city));
    setCities([]);
    setOpen(false);
    setStatus("");
  }
  return (
    <div className="relative space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        role="combobox"
        autoComplete="off"
        value={query}
        aria-expanded={open && cities.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={
          open && active >= 0 ? `${id}-${active}` : undefined
        }
        aria-invalid={!!error}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        onBlur={() => setOpen(false)}
        onFocus={() => {
          if (cities.length) setOpen(true);
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (value) onChange(null);
          setQuery(next);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, cities.length - 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          }
          if (event.key === "Enter" && open && active >= 0 && cities[active]) {
            event.preventDefault();
            choose(cities[active]);
          }
        }}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {value
          ? value.timeZone
          : "Search U.S. cities, then choose a city and state."}
      </p>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {open && cities.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} results`}
          className="absolute z-20 max-h-80 w-full overflow-auto rounded-md border bg-white shadow-lg"
        >
          {cities.map((city, index) => (
            <li
              role="option"
              aria-selected={index === active}
              id={`${id}-${index}`}
              key={city.id}
              className={`cursor-pointer px-3 py-3 text-sm ${index === active ? "bg-slate-100" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(city)}
            >
              {cityLabel(city)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
