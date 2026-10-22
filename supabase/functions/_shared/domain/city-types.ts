/** A GeoNames inhabited-place center, not an airport or street address. */
export interface City {
  id: string
  name: string
  stateCode: string
  stateName: string
  countryCode: 'US' | 'PR' | 'VI' | 'GU' | 'AS' | 'MP'
  countyName: string | null
  latitude: number
  longitude: number
  timeZone: string
}
