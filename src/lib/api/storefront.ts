import { post } from './client';
import type { SearchResult } from './types';

export interface TripFilter {
  minPriceMinor?: number;
  maxPriceMinor?: number;
  departAfter?: string;
  departBefore?: string;
  seatTypes?: string[];
  amenities?: string[];
  minRating?: number;
  minSeats?: number;
}

export interface SearchInput {
  originCityId: string;
  destCityId: string;
  journeyDate: string;
  filter?: TripFilter;
  sort?: 'price' | 'departure' | 'duration' | 'rating';
  sortDir?: 'asc' | 'desc';
}

export interface ConnectingJourney {
  legs: [SearchResult & { fromHub: string; toHub: string }, SearchResult & { fromHub: string; toHub: string }];
  hub: string;
  hubCity: { cityId: string; name: string };
  layoverMin: number;
  totalPriceMinor: number;
  totalDurationMin: number;
  minSeats: number;
  currency: string;
}

export const storefrontApi = {
  search: (input: SearchInput) => post<{ results: SearchResult[]; count: number }>('/v1/search', input),
  roundTrip: (input: Omit<SearchInput, 'journeyDate' | 'sortDir'> & { onwardDate: string; returnDate: string }) =>
    post<{ onward: SearchResult[]; return: SearchResult[] }>('/v1/search/round-trip', input),
  connecting: (input: { originCityId: string; hubCityId?: string; destCityId: string; journeyDate: string; minLayoverMin?: number; maxLayoverMin?: number }) =>
    post<{ journeys: ConnectingJourney[]; count: number }>('/v1/search/connecting', input),
};
