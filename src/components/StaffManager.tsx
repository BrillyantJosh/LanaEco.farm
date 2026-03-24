import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParams } from '@/contexts/SystemParamsContext';
import { publishToRelays, type BusinessUnit } from '@/lib/nostr';
import { signNostrEvent } from '@/lib/nostrSigning';
import { convertWifToIds } from '@/lib/crypto';
import { X, Plus, Trash2, Loader2, UserCheck, UserX, Search, Key, Camera, Crown } from 'lucide-react';
import QrScanner from '@/components/QrScanner';

interface StaffMember {
  hexId: string;
  name: string | null;
  verified: boolean;
}

interface StaffManagerProps {
  unit: BusinessUnit;
  onClose: () => void;
  onSaved: () => void;
}

export function StaffManager({ unit, onClose, onSaved }: StaffManagerProps) {
  const { session } = useAuth();
  const { params } = useSystemParams();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [inputMode, setInputMode] = useState<'hex' | 'wif'>('hex');
  const [inputValue, setInputValue] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [owner, setOwner] = useState<StaffMember | null>(null);

  // Load existing staff from p tags + owner
  useEffect(() => {
    const ownerHex = unit.ownerHex || unit.pubkey;

    // Set owner (verify separately)
    setOwner({ hexId: ownerHex, name: null, verified: false });
    if (params?.relays) {
      fetchProfileName(ownerHex, params.relays).then(name => {
        setOwner({ hexId: ownerHex, name, verified: name !== null });
      });
    }

    const pTags = unit.rawEvent.tags
      .filter(t => t[0] === 'p')
      .map(t => t[1])
      .filter(hex => hex !== ownerHex);

    // Deduplicate
    const unique = [...new Set(pTags)];

    // Initialize staff with unverified status, then verify
    const members: StaffMember[] = unique.map(hex => ({
      hexId: hex,
      name: null,
      verified: false,
    }));
    setStaff(members);

    // Verify all existing staff
    if (members.length > 0 && params?.relays) {
      members.forEach(m => verifyHex(m.hexId, true));
    }
  }, [unit]);

  const verifyHex = async (hexId: string, silent = false): Promise<string | null> => {
    if (!params?.relays) return null;

    try {
      // Fetch KIND 0 profile from relays
      const profileName = await fetchProfileName(hexId, params.relays);

      setStaff(prev =>
        prev.map(s =>
          s.hexId === hexId
            ? { ...s, name: profileName, verified: profileName !== null }
            : s
        )
      );

      return profileName;
    } catch {
      if (!silent) setError('Failed to verify profile on relays');
      return null;
    }
  };

  const fetchProfileName = (hexId: string, relays: string[]): Promise<string | null> => {
    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(null); }
      }, 8000);

      let attempts = 0;
      const totalRelays = relays.length;

      for (const relayUrl of relays) {
        let ws: WebSocket;
        try {
          ws = new WebSocket(relayUrl);
        } catch {
          attempts++;
          if (attempts >= totalRelays && !resolved) { resolved = true; resolve(null); }
          continue;
        }

        const subId = `staff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        ws.onopen = () => {
          ws.send(JSON.stringify(['REQ', subId, {
            kinds: [0],
            authors: [hexId],
            limit: 1,
          }]));
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg[0] === 'EVENT' && msg[1] === subId && !resolved) {
              const content = JSON.parse(msg[2].content);
              const name = content.display_name || content.name || null;
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              resolve(name);
            } else if (msg[0] === 'EOSE' && !resolved) {
              ws.close();
              attempts++;
              if (attempts >= totalRelays && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(null);
              }
            }
          } catch {}
        };

        ws.onerror = () => {
          attempts++;
          if (attempts >= totalRelays && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
          }
        };
      }
    });
  };

  const handleAddStaff = async () => {
    if (!inputValue.trim()) return;
    setError(null);
    setIsVerifying(true);

    try {
      let hexId: string;

      if (inputMode === 'wif') {
        // Derive hex from WIF
        try {
          const ids = await convertWifToIds(inputValue.trim());
          hexId = ids.nostrHexId;
        } catch {
          setError('Invalid WIF key. Please check and try again.');
          setIsVerifying(false);
          return;
        }
      } else {
        hexId = inputValue.trim().toLowerCase();
        // Validate hex format
        if (!/^[0-9a-f]{64}$/.test(hexId)) {
          setError('Invalid Nostr HEX ID. Must be 64 lowercase hex characters.');
          setIsVerifying(false);
          return;
        }
      }

      // Check if already added
      const ownerHex = session?.nostrHexId || '';
      if (hexId === ownerHex) {
        setError('Owner is already included automatically.');
        setIsVerifying(false);
        return;
      }
      if (staff.some(s => s.hexId === hexId)) {
        setError('This person is already in the staff list.');
        setIsVerifying(false);
        return;
      }

      // Verify on relays
      const profileName = await fetchProfileName(hexId, params?.relays || []);
      if (!profileName) {
        setError('Profile not found on relays. Cannot add unverified user.');
        setIsVerifying(false);
        return;
      }

      // Add to staff list
      setStaff(prev => [...prev, { hexId, name: profileName, verified: true }]);
      setInputValue('');
      setHasChanges(true);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRemoveStaff = (hexId: string) => {
    setStaff(prev => prev.filter(s => s.hexId !== hexId));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!session || !params?.relays) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Rebuild the full event tags from the raw event, updating p tags
      const ownerHex = unit.ownerHex || session.nostrHexId;
      const originalTags = unit.rawEvent.tags;

      // Keep all non-p tags
      const newTags: string[][] = originalTags.filter(t => t[0] !== 'p');

      // Add owner p tag first
      newTags.push(['p', ownerHex]);

      // Add all staff p tags
      for (const member of staff) {
        newTags.push(['p', member.hexId]);
      }

      // Sign new event
      const signedEvent = signNostrEvent(
        session.nostrPrivateKey,
        30901,
        unit.content,
        newTags
      );

      // Publish
      const result = await publishToRelays(signedEvent, params.relays);

      if (result.success.length > 0) {
        setSuccess(`Saved! Published to ${result.success.length} relay(s).`);
        setHasChanges(false);
        setTimeout(() => {
          onSaved();
          onClose();
        }, 1500);
      } else {
        setError('Failed to publish to relays. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Staff — {unit.name}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Manage who can sell through this unit</p>
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Current Staff List */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Staff ({1 + staff.length})
            </h3>

            <div className="space-y-2">
              {/* Owner — always first, not removable */}
              {owner && (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {owner.name || 'Verifying...'} <span className="text-xs text-amber-600 dark:text-amber-400 font-normal">(Owner)</span>
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
                        {owner.hexId.slice(0, 16)}...{owner.hexId.slice(-8)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Staff members */}
              {staff.map(member => (
                <div
                  key={member.hexId}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {member.verified ? (
                      <UserCheck className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                    ) : (
                      <UserX className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                        {member.name || 'Verifying...'}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">
                        {member.hexId.slice(0, 16)}...{member.hexId.slice(-8)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveStaff(member.hexId)}
                    className="flex-shrink-0 p-1.5 text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add Staff */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Add Staff Member</h3>

            {/* Input Mode Toggle */}
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => { setInputMode('hex'); setInputValue(''); setError(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  inputMode === 'hex'
                    ? 'bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-700'
                    : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-600'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                Nostr HEX ID
              </button>
              <button
                type="button"
                onClick={() => { setInputMode('wif'); setInputValue(''); setError(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  inputMode === 'wif'
                    ? 'bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-700'
                    : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-600'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                Scan Private LANA Key
              </button>
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <input
                type={inputMode === 'wif' ? 'password' : 'text'}
                value={inputValue}
                onChange={e => { setInputValue(e.target.value); setError(null); }}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddStaff())}
                placeholder={inputMode === 'hex' ? 'Enter 64-char Nostr HEX ID...' : 'Enter WIF private key...'}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                disabled={isVerifying}
              />
              {inputMode === 'wif' && (
                <button
                  type="button"
                  onClick={() => setShowQrScanner(true)}
                  className="flex items-center justify-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                  title="Scan QR code"
                  disabled={isVerifying}
                >
                  <Camera className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              )}
              <button
                onClick={handleAddStaff}
                disabled={isVerifying || !inputValue.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50"
              >
                {isVerifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Add
              </button>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
              {inputMode === 'hex'
                ? 'Profile will be verified on relays before adding.'
                : 'HEX ID will be derived from the WIF key and verified on relays.'}
            </p>
          </div>

          {/* Messages */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
          {success && (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <p className="text-sm text-green-700 dark:text-green-400">{success}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition ${
              hasChanges
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 dark:bg-gray-600 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            }`}
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserCheck className="w-4 h-4" />
            )}
            {isSaving ? 'Publishing...' : 'Save & Publish'}
          </button>
        </div>
      </div>

      {/* QR Scanner */}
      {showQrScanner && (
        <QrScanner
          onScan={(value) => {
            setShowQrScanner(false);
            setInputValue(value);
            setInputMode('wif');
          }}
          onClose={() => setShowQrScanner(false)}
        />
      )}
    </div>
  );
}
