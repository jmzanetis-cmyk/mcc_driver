// ============================================================
// MCC Driver — Vehicle Inspection Screen
// ============================================================
// Guided pre/post walk-around photo capture for relocation and
// concierge rides. Route: /ride/:rideId/inspection/:phase
//
// Flow:
//   1. Overview grid — 6 required + 1 optional angle tile
//   2. Angle view — ghost guide → capture → tap-to-annotate
//   3. Submit — upload to Supabase Storage + write vehicle_inspections row
//
// Storage bucket: relocation-photos (must exist in Supabase dashboard)
// Path format: {rideId}/inspection/{phase}/{angleId}.jpg
// ============================================================

import React, { useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button, Spinner, PageHeader } from '@/components';
import { colors, borderRadius, withAlpha } from '@/theme';
import type { InspectionPhotoData } from '@/services/supabase/types';

// ── Angle definitions ────────────────────────────────────────────────────────

const INSPECTION_ANGLES = [
  {
    id: 'front' as const,
    label: 'Front',
    required: true,
    icon: '▲',
    guide: 'Stand directly in front. Frame the full bumper to roofline.',
    directionHint: 'FRONT VIEW',
  },
  {
    id: 'rear' as const,
    label: 'Rear',
    required: true,
    icon: '▼',
    guide: 'Stand directly behind. Frame the full rear bumper to roofline.',
    directionHint: 'REAR VIEW',
  },
  {
    id: 'driver_side' as const,
    label: "Driver's Side",
    required: true,
    icon: '◀',
    guide: "Stand to the left. Capture the full driver's side profile, both wheels visible.",
    directionHint: 'LEFT SIDE PROFILE',
  },
  {
    id: 'passenger_side' as const,
    label: "Passenger's Side",
    required: true,
    icon: '▶',
    guide: "Stand to the right. Capture the full passenger's side profile, both wheels visible.",
    directionHint: 'RIGHT SIDE PROFILE',
  },
  {
    id: 'odometer' as const,
    label: 'Odometer',
    required: true,
    icon: '🔢',
    guide: 'Open the driver door. Photograph the odometer reading clearly.',
    directionHint: 'ODOMETER CLOSE-UP',
  },
  {
    id: 'dashboard' as const,
    label: 'Dashboard',
    required: true,
    icon: '📊',
    guide: 'Photograph the full dashboard — fuel level, warning lights, and instrument cluster.',
    directionHint: 'FULL DASHBOARD',
  },
  {
    id: 'damage_extra' as const,
    label: 'Existing Damage',
    required: false,
    icon: '🔍',
    guide: 'Close-up of any pre-existing scratches, dents, or damage. Skip if none.',
    directionHint: 'DAMAGE CLOSE-UP',
  },
] as const;

type AngleId = typeof INSPECTION_ANGLES[number]['id'];
const REQUIRED_ANGLES = INSPECTION_ANGLES.filter(a => a.required).map(a => a.id);

interface PhotoData {
  dataUrl: string;
  damageNote: string;
  damageMarker: { x: number; y: number } | null; // % of image dimensions
  capturedAt: string;
  lat: number | null;
  lng: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getGps(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 3000, maximumAge: 10_000 },
    );
  });
}

// ── Car silhouette SVGs per angle ────────────────────────────────────────────

function CarSilhouette({ angleId }: { angleId: AngleId }) {
  const fill   = withAlpha(colors.navy, '08');
  const stroke = withAlpha(colors.navy, '35');
  const glass  = withAlpha('#6AB0FF', '18');
  const amber  = withAlpha('#FFD740', '45');
  const red    = withAlpha('#FF4444', '40');

  if (angleId === 'front') return (
    <svg viewBox="0 0 160 96" width={140} height={84} fill="none" aria-hidden>
      <rect x="6" y="44" width="148" height="38" rx="7" fill={fill} stroke={stroke} strokeWidth="2"/>
      <path d="M30 44 L42 16 L118 16 L130 44" fill={fill} stroke={stroke} strokeWidth="2"/>
      <rect x="44" y="18" width="72" height="24" rx="3" fill={glass} stroke={stroke} strokeWidth="1.5"/>
      <ellipse cx="38" cy="82" rx="17" ry="10" fill="none" stroke={stroke} strokeWidth="2"/>
      <ellipse cx="122" cy="82" rx="17" ry="10" fill="none" stroke={stroke} strokeWidth="2"/>
      <rect x="8"  y="54" width="24" height="11" rx="3" fill={amber}  stroke={stroke} strokeWidth="1.5"/>
      <rect x="128" y="54" width="24" height="11" rx="3" fill={amber} stroke={stroke} strokeWidth="1.5"/>
      <rect x="48" y="64" width="64" height="9" rx="3" fill="none" stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );

  if (angleId === 'rear') return (
    <svg viewBox="0 0 160 96" width={140} height={84} fill="none" aria-hidden>
      <rect x="6" y="44" width="148" height="38" rx="7" fill={fill} stroke={stroke} strokeWidth="2"/>
      <path d="M30 44 L42 16 L118 16 L130 44" fill={fill} stroke={stroke} strokeWidth="2"/>
      <rect x="44" y="18" width="72" height="24" rx="3" fill={glass} stroke={stroke} strokeWidth="1.5"/>
      <ellipse cx="38" cy="82" rx="17" ry="10" fill="none" stroke={stroke} strokeWidth="2"/>
      <ellipse cx="122" cy="82" rx="17" ry="10" fill="none" stroke={stroke} strokeWidth="2"/>
      <rect x="8"  y="54" width="24" height="11" rx="3" fill={red}  stroke={stroke} strokeWidth="1.5"/>
      <rect x="128" y="54" width="24" height="11" rx="3" fill={red} stroke={stroke} strokeWidth="1.5"/>
      <rect x="52" y="60" width="56" height="14" rx="4" fill={withAlpha('#FFD740', '20')} stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );

  if (angleId === 'driver_side' || angleId === 'passenger_side') return (
    <svg viewBox="0 0 200 96" width={170} height={82} fill="none" aria-hidden>
      <rect x="8" y="56" width="184" height="26" rx="7" fill={fill} stroke={stroke} strokeWidth="2"/>
      <path d="M28 56 L46 24 L90 18 L148 18 L168 56" fill={fill} stroke={stroke} strokeWidth="2"/>
      <rect x="48" y="20" width="98" height="34" rx="4" fill={glass} stroke={stroke} strokeWidth="1.5"/>
      <ellipse cx="50" cy="82" rx="20" ry="13" fill="none" stroke={stroke} strokeWidth="2"/>
      <ellipse cx="150" cy="82" rx="20" ry="13" fill="none" stroke={stroke} strokeWidth="2"/>
      <rect x="8"  y="65" width="14" height="10" rx="2" fill={angleId === 'driver_side' ? amber : red}  stroke={stroke} strokeWidth="1.5"/>
      <rect x="178" y="65" width="14" height="10" rx="2" fill={angleId === 'driver_side' ? red : amber} stroke={stroke} strokeWidth="1.5"/>
      <rect x="88" y="38" width="22" height="16" rx="3" fill="none" stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );

  if (angleId === 'odometer') return (
    <svg viewBox="0 0 160 96" width={140} height={84} fill="none" aria-hidden>
      <rect x="10" y="8" width="140" height="80" rx="8" fill={fill} stroke={stroke} strokeWidth="2"/>
      <circle cx="80" cy="58" r="32" fill="none" stroke={stroke} strokeWidth="2"/>
      <circle cx="80" cy="58" r="22" fill="none" stroke={stroke} strokeWidth="1"/>
      {[...Array(9)].map((_, i) => {
        const a = ((i * 20) - 90) * (Math.PI / 180);
        return <line key={i} x1={80+30*Math.cos(a)} y1={58+30*Math.sin(a)} x2={80+34*Math.cos(a)} y2={58+34*Math.sin(a)} stroke={stroke} strokeWidth="2"/>;
      })}
      <line x1="80" y1="58" x2="97" y2="34" stroke={stroke} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="80" cy="58" r="4" fill={stroke}/>
      <rect x="54" y="12" width="52" height="20" rx="4" fill={withAlpha('#4B9EFF', '20')} stroke={stroke} strokeWidth="1.5"/>
      <rect x="58" y="16" width="10" height="12" rx="1" fill={stroke} opacity=".3"/>
      <rect x="71" y="16" width="10" height="12" rx="1" fill={stroke} opacity=".3"/>
      <rect x="84" y="16" width="10" height="12" rx="1" fill={stroke} opacity=".3"/>
    </svg>
  );

  if (angleId === 'dashboard') return (
    <svg viewBox="0 0 160 96" width={140} height={84} fill="none" aria-hidden>
      <rect x="10" y="8" width="140" height="80" rx="8" fill={fill} stroke={stroke} strokeWidth="2"/>
      <circle cx="50" cy="54" r="22" fill="none" stroke={stroke} strokeWidth="2"/>
      <circle cx="110" cy="54" r="22" fill="none" stroke={stroke} strokeWidth="2"/>
      <line x1="50" y1="54" x2="58" y2="36" stroke={stroke} strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="110" y1="54" x2="120" y2="42" stroke={stroke} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="50" cy="54" r="3" fill={stroke}/>
      <circle cx="110" cy="54" r="3" fill={stroke}/>
      <rect x="68" y="42" width="24" height="24" rx="4" fill={withAlpha('#4B9EFF', '20')} stroke={stroke} strokeWidth="1.5"/>
      <rect x="20" y="14" width="120" height="16" rx="3" fill="none" stroke={stroke} strokeWidth="1.5"/>
      <rect x="24" y="18" width="18" height="8" rx="2" fill={amber} stroke={stroke} strokeWidth="1"/>
      <rect x="46" y="18" width="12" height="8" rx="2" fill={withAlpha('#44FF99', '40')} stroke={stroke} strokeWidth="1"/>
    </svg>
  );

  // damage_extra — magnifying glass
  return (
    <svg viewBox="0 0 120 120" width={100} height={100} fill="none" aria-hidden>
      <circle cx="50" cy="50" r="36" fill={fill} stroke={stroke} strokeWidth="2.5"/>
      <circle cx="50" cy="50" r="23" fill="none" stroke={stroke} strokeWidth="1.5"/>
      <line x1="78" y1="78" x2="108" y2="108" stroke={stroke} strokeWidth="4.5" strokeLinecap="round"/>
      <path d="M36 50 C36 42 44 36 52 38" stroke={red} strokeWidth="2" strokeLinecap="round"/>
      <path d="M42 56 L48 50 L54 56 L60 50" stroke={red} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function GhostGuide({ angle }: { angle: typeof INSPECTION_ANGLES[number] }) {
  return (
    <div style={{
      border: `2px dashed ${withAlpha(colors.gold, '65')}`,
      borderRadius: borderRadius.lg,
      background: withAlpha(colors.navy, '03'),
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '28px 20px', gap: 14, minHeight: 228,
    }}>
      <CarSilhouette angleId={angle.id} />
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
        color: withAlpha(colors.gold, '85'), textTransform: 'uppercase',
      }}>
        {angle.directionHint}
      </div>
      <div style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 1.55, maxWidth: 240 }}>
        {angle.guide}
      </div>
    </div>
  );
}

// ── Overview grid tile ───────────────────────────────────────────────────────

function AngleTile({
  angle,
  photo,
  onTap,
}: {
  angle: typeof INSPECTION_ANGLES[number];
  photo: PhotoData | undefined;
  onTap: () => void;
}) {
  const captured = !!photo;
  return (
    <button
      onClick={onTap}
      style={{
        padding: 0,
        border: `2px solid ${captured ? colors.success : angle.required ? colors.border : withAlpha(colors.border, '70')}`,
        borderRadius: borderRadius.md,
        background: captured ? withAlpha(colors.success, '07') : colors.bgSecondary,
        cursor: 'pointer', fontFamily: 'inherit',
        overflow: 'hidden', minHeight: 96,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}
    >
      {captured ? (
        <>
          <img
            src={photo!.dataUrl} alt={angle.label}
            style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
          />
          {photo!.damageMarker && (
            <div style={{
              position: 'absolute',
              left: `${photo!.damageMarker.x}%`, top: `${photo!.damageMarker.y}%`,
              transform: 'translate(-50%,-50%)',
              width: 12, height: 12, borderRadius: '50%',
              background: '#DC2626', border: '2px solid #fff',
              pointerEvents: 'none',
            }}/>
          )}
          <div style={{
            position: 'absolute', bottom: 4, right: 4,
            background: colors.success, borderRadius: '50%',
            width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: '#fff',
          }}>✓</div>
          {!angle.required && (
            <div style={{
              position: 'absolute', top: 4, left: 4,
              fontSize: 8, color: '#fff', background: 'rgba(0,0,0,0.55)',
              padding: '2px 5px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>opt</div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 20, marginBottom: 3 }}>{angle.icon}</div>
          <div style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center', padding: '0 4px', lineHeight: 1.3 }}>{angle.label}</div>
          <div style={{
            fontSize: angle.required ? 16 : 11,
            color: colors.textMuted, marginTop: 3,
            fontStyle: angle.required ? 'normal' : 'italic',
          }}>
            {angle.required ? '+' : 'optional'}
          </div>
        </>
      )}
    </button>
  );
}

// ── Tap-to-annotate photo viewer ─────────────────────────────────────────────

function PhotoAnnotation({
  angle,
  photo,
  onChange,
}: {
  angle: typeof INSPECTION_ANGLES[number];
  photo: PhotoData;
  onChange: (p: PhotoData) => void;
}) {
  const imgRef = useRef<HTMLDivElement>(null);

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    onChange({ ...photo, damageMarker: { x, y } });
  };

  return (
    <>
      {/* Photo + damage marker */}
      <div
        ref={imgRef}
        onClick={handleTap}
        style={{
          position: 'relative', cursor: 'crosshair',
          borderRadius: borderRadius.md, overflow: 'hidden',
          border: `1px solid ${colors.border}`, userSelect: 'none',
        }}
      >
        <img
          src={photo.dataUrl} alt={angle.label}
          style={{ width: '100%', display: 'block', maxHeight: 260, objectFit: 'cover' }}
          draggable={false}
        />
        {!photo.damageMarker && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(0,0,0,0.42)', color: '#fff',
            fontSize: 11, textAlign: 'center', padding: '6px 0',
            pointerEvents: 'none',
          }}>
            Tap photo to mark damage location
          </div>
        )}
        {photo.damageMarker && (
          <div
            onClick={(e) => { e.stopPropagation(); onChange({ ...photo, damageMarker: null }); }}
            style={{
              position: 'absolute',
              left: `${photo.damageMarker.x}%`, top: `${photo.damageMarker.y}%`,
              transform: 'translate(-50%,-50%)',
              cursor: 'pointer',
            }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: '#DC2626', border: '3px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              fontSize: 14, color: '#fff', fontWeight: 700,
            }}>!</div>
          </div>
        )}
      </div>
      {photo.damageMarker && (
        <div style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 5 }}>
          Damage marker set — tap marker to remove, or tap elsewhere on photo to move it
        </div>
      )}

      {/* Damage notes */}
      <div style={{ marginTop: 16 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, display: 'block', marginBottom: 6 }}>
          Damage Notes <span style={{ fontWeight: 400, fontStyle: 'italic' }}>(optional)</span>
        </label>
        <textarea
          value={photo.damageNote}
          onChange={(e) => onChange({ ...photo, damageNote: e.target.value })}
          placeholder="Describe any pre-existing scratches, dents, or damage…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px', borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.bgSecondary, color: colors.textPrimary,
            fontSize: 14, fontFamily: 'inherit', resize: 'vertical', outline: 'none',
          }}
        />
      </div>
    </>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export function VehicleInspectionScreen() {
  const { rideId, phase } = useParams<{ rideId: string; phase: 'pickup' | 'dropoff' }>();
  const navigate = useNavigate();
  const { driver } = useAuth();

  const [photos, setPhotos] = useState<Partial<Record<AngleId, PhotoData>>>({});
  const [odometerReading, setOdometerReading] = useState('');
  const [activeAngle, setActiveAngle] = useState<AngleId | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAngleRef = useRef<AngleId | null>(null);
  const pendingGpsRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

  const requiredCount = REQUIRED_ANGLES.filter(id => !!photos[id]).length;
  const requiredDone = requiredCount === REQUIRED_ANGLES.length;
  const phaseLabel = phase === 'pickup' ? 'Pre-Pickup' : 'Post-Delivery';

  // ── Photo capture ──────────────────────────────────────────────────────────

  const capturePhoto = useCallback(async (angleId: AngleId) => {
    if (Capacitor.isNativePlatform()) {
      const gps = await getGps();
      try {
        const photo = await Camera.getPhoto({
          quality: 85,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          promptLabelHeader: INSPECTION_ANGLES.find(a => a.id === angleId)?.label ?? 'Take Photo',
        });
        if (!photo.dataUrl) return;
        setPhotos(p => ({
          ...p,
          [angleId]: {
            dataUrl: photo.dataUrl!,
            damageNote: p[angleId]?.damageNote ?? '',
            damageMarker: p[angleId]?.damageMarker ?? null,
            capturedAt: new Date().toISOString(),
            lat: gps.lat, lng: gps.lng,
          },
        }));
      } catch { /* user cancelled */ }
    } else {
      const gps = await getGps();
      pendingGpsRef.current = gps;
      pendingAngleRef.current = angleId;
      fileInputRef.current?.click();
    }
  }, [photos]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const angleId = pendingAngleRef.current;
    if (!file || !angleId) return;
    const dataUrl = URL.createObjectURL(file);
    const gps = pendingGpsRef.current;
    setPhotos(p => ({
      ...p,
      [angleId]: {
        dataUrl,
        damageNote: p[angleId]?.damageNote ?? '',
        damageMarker: p[angleId]?.damageMarker ?? null,
        capturedAt: new Date().toISOString(),
        lat: gps.lat, lng: gps.lng,
      },
    }));
    pendingAngleRef.current = null;
    pendingGpsRef.current = { lat: null, lng: null };
    e.target.value = '';
  };

  const updatePhoto = useCallback((angleId: AngleId, data: PhotoData) => {
    setPhotos(p => ({ ...p, [angleId]: data }));
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!rideId || !driver) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const photoEntries: InspectionPhotoData[] = [];
      for (const angle of INSPECTION_ANGLES) {
        const photo = photos[angle.id];
        if (!photo) continue;
        const path = `${rideId}/inspection/${phase}/${angle.id}.jpg`;
        setUploadProgress(`Uploading ${angle.label}…`);
        const blob = await fetch(photo.dataUrl).then(r => r.blob());
        await supabase.storage.from('relocation-photos').upload(path, blob, {
          contentType: 'image/jpeg', upsert: true,
        });
        photoEntries.push({
          angleId: angle.id, storagePath: path,
          damageNote: photo.damageNote, damageMarker: photo.damageMarker,
          capturedAt: photo.capturedAt, lat: photo.lat, lng: photo.lng,
        });
      }
      setUploadProgress('Saving inspection record…');
      const { error } = await supabase.from('driver_ride_inspections').insert({
        ride_id: rideId,
        driver_id: driver.id,
        phase,
        photos_json: photoEntries,
        odometer_reading: odometerReading.trim() ? parseInt(odometerReading, 10) : null,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      });
      if (error) throw error;
      navigate(`/ride/${rideId}/relocation`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
      setUploadProgress('');
    }
  }, [rideId, driver, photos, phase, odometerReading, navigate]);

  // ── Upload overlay ─────────────────────────────────────────────────────────

  if (submitting) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: colors.bgPrimary, padding: 24,
      }}>
        <Spinner size={36} color={colors.gold} />
        <div style={{ marginTop: 20, fontSize: 15, color: colors.textMuted, textAlign: 'center' }}>
          {uploadProgress || 'Submitting inspection…'}
        </div>
      </div>
    );
  }

  // ── Angle capture view ─────────────────────────────────────────────────────

  if (activeAngle !== null) {
    const angle = INSPECTION_ANGLES.find(a => a.id === activeAngle)!;
    const photo = photos[activeAngle];
    const reqIdx = REQUIRED_ANGLES.indexOf(activeAngle);
    const headerSuffix = reqIdx >= 0
      ? ` (${reqIdx + 1} of ${REQUIRED_ANGLES.length})`
      : ' (Optional)';

    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} style={{ display: 'none' }} />

        <PageHeader title={angle.label + headerSuffix} onBack={() => setActiveAngle(null)} />

        <div style={{ flex: 1, padding: '12px 20px 36px', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 14, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {phaseLabel} Inspection · {angle.label}
          </div>

          {/* Ghost guide or captured photo */}
          {!photo ? (
            <GhostGuide angle={angle} />
          ) : (
            <PhotoAnnotation
              angle={angle}
              photo={photo}
              onChange={(p) => updatePhoto(activeAngle, p)}
            />
          )}

          {/* Odometer reading field */}
          {activeAngle === 'odometer' && photo && (
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, display: 'block', marginBottom: 6 }}>
                Odometer Reading (miles)
              </label>
              <input
                type="number"
                value={odometerReading}
                onChange={e => setOdometerReading(e.target.value)}
                placeholder="e.g. 42500"
                inputMode="numeric"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 14px', borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.bgSecondary, color: colors.textPrimary,
                  fontSize: 18, fontFamily: 'monospace', outline: 'none',
                }}
              />
            </div>
          )}

          {/* Actions */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!photo ? (
              <Button onClick={() => void capturePhoto(activeAngle)} fullWidth size="lg">
                📷 Take Photo
              </Button>
            ) : (
              <>
                <Button onClick={() => setActiveAngle(null)} fullWidth size="lg" variant="success">
                  ✓ Done — Back to Overview
                </Button>
                <Button onClick={() => void capturePhoto(activeAngle)} fullWidth size="md" variant="secondary">
                  Retake Photo
                </Button>
              </>
            )}
            <Button
              onClick={() => setActiveAngle(null)}
              fullWidth size="sm" variant="ghost"
              style={{ color: colors.textMuted, marginTop: 4 }}
            >
              ← Back to Overview
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Overview grid ──────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} style={{ display: 'none' }} />

      <PageHeader
        title={`${phaseLabel} Inspection`}
        onBack={() => navigate(`/ride/${rideId}/relocation`)}
      />

      <div style={{ flex: 1, padding: '16px 20px 36px', overflowY: 'auto' }}>
        {/* Progress */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: colors.textMuted }}>
            <span style={{ fontWeight: 700, color: requiredDone ? colors.success : colors.navy }}>
              {requiredCount}
            </span>
            <span>/{REQUIRED_ANGLES.length} required photos</span>
          </div>
          {requiredDone && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: colors.success,
              background: withAlpha(colors.success, '12'),
              padding: '3px 10px', borderRadius: borderRadius.full,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              All Required ✓
            </span>
          )}
        </div>

        {/* Angle grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
          {INSPECTION_ANGLES.map((angle) => (
            <AngleTile
              key={angle.id}
              angle={angle}
              photo={photos[angle.id]}
              onTap={() => setActiveAngle(angle.id)}
            />
          ))}
        </div>

        {/* Instruction callout */}
        {!requiredDone && (
          <div style={{
            padding: '12px 16px', borderRadius: borderRadius.md,
            background: withAlpha(colors.gold, '09'),
            border: `1px solid ${withAlpha(colors.gold, '28')}`,
            fontSize: 13, color: colors.textSecondary,
            lineHeight: 1.55, marginBottom: 20,
          }}>
            Tap each slot to photograph that angle. GPS and timestamp are captured automatically.
            After taking a photo, tap it to mark any pre-existing damage location.
          </div>
        )}

        {/* Error */}
        {submitError && (
          <div style={{
            padding: '10px 14px', borderRadius: borderRadius.md,
            background: '#FEF2F2', border: '1px solid #FCA5A5',
            color: '#991B1B', fontSize: 13, fontWeight: 600, marginBottom: 16,
          }}>
            {submitError}
          </div>
        )}

        {/* Submit */}
        <Button
          onClick={() => void handleSubmit()}
          fullWidth size="lg"
          disabled={!requiredDone}
          variant={requiredDone ? 'success' : 'secondary'}
          style={requiredDone ? { boxShadow: `0 6px 28px ${withAlpha(colors.success, '50')}` } : undefined}
        >
          {requiredDone
            ? `Submit ${phaseLabel} Inspection`
            : `${REQUIRED_ANGLES.length - requiredCount} more photo${REQUIRED_ANGLES.length - requiredCount !== 1 ? 's' : ''} required`}
        </Button>
      </div>
    </div>
  );
}
