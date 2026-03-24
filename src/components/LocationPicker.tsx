import { useState } from 'react';
import { MapPin, Navigation, Search, Loader2, X } from 'lucide-react';

interface LocationPickerProps {
  latitude: string;
  longitude: string;
  onLocationChange: (lat: string, lng: string) => void;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

export function LocationPicker({ latitude, longitude, onLocationChange }: LocationPickerProps) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setIsDetecting(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        onLocationChange(
          position.coords.latitude.toFixed(6),
          position.coords.longitude.toFixed(6)
        );
        setIsDetecting(false);
      },
      (err) => {
        setError(`Location error: ${err.message}`);
        setIsDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const searchLocation = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setSearchResults([]);

    try {
      const encoded = encodeURIComponent(searchQuery.trim());
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      );

      if (!res.ok) throw new Error('Search failed');

      const data: SearchResult[] = await res.json();
      if (data.length === 0) {
        setError('No results found. Try a different search.');
      } else {
        setSearchResults(data);
      }
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const selectResult = (result: SearchResult) => {
    onLocationChange(
      parseFloat(result.lat).toFixed(6),
      parseFloat(result.lon).toFixed(6)
    );
    setSearchResults([]);
    setSearchQuery('');
  };

  const hasLocation = latitude && longitude;

  const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <MapPin className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Location</span>
      </div>

      {/* Auto-detect + Search row */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={detectLocation}
          disabled={isDetecting}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition text-sm font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {isDetecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Navigation className="w-4 h-4" />
          )}
          Auto-detect
        </button>

        <div className="flex-1 flex gap-1">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), searchLocation())}
            placeholder="Search address or city..."
            className={inputClass}
          />
          <button
            type="button"
            onClick={searchLocation}
            disabled={isSearching || !searchQuery.trim()}
            className="flex items-center gap-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm disabled:opacity-50"
          >
            {isSearching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 shadow-sm">
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
            <span className="text-xs text-gray-500 dark:text-gray-400">Select a location:</span>
            <button type="button" onClick={() => setSearchResults([])} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {searchResults.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => selectResult(r)}
              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-b dark:border-gray-700 last:border-b-0 transition"
            >
              <p className="text-sm text-gray-800 dark:text-gray-200 leading-tight">{r.display_name}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{parseFloat(r.lat).toFixed(6)}, {parseFloat(r.lon).toFixed(6)}</p>
            </button>
          ))}
        </div>
      )}

      {/* Lat/Lng inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Latitude *</label>
          <input
            className={inputClass}
            value={latitude}
            onChange={e => onLocationChange(e.target.value, longitude)}
            placeholder="46.056946"
          />
        </div>
        <div>
          <label className={labelClass}>Longitude *</label>
          <input
            className={inputClass}
            value={longitude}
            onChange={e => onLocationChange(latitude, e.target.value)}
            placeholder="14.505751"
          />
        </div>
      </div>

      {/* Map preview via OpenStreetMap embed */}
      {hasLocation && (
        <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
          <iframe
            title="Map preview"
            width="100%"
            height="200"
            style={{ border: 0 }}
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(longitude) - 0.01},${parseFloat(latitude) - 0.007},${parseFloat(longitude) + 0.01},${parseFloat(latitude) + 0.007}&layer=mapnik&marker=${latitude},${longitude}`}
          />
          <a
            href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-xs text-blue-500 dark:text-blue-400 text-center py-1.5 hover:underline"
          >
            Open in OpenStreetMap
          </a>
        </div>
      )}

      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
