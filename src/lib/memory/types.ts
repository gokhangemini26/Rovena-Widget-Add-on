/* ═══════════════════════════════════════════════════════════════════════════
   User Style DNA & Memory Types (KVKK / GDPR Compliant)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface UserSizes {
  top?: string; // e.g. "L", "52"
  bottom?: string; // e.g. "50", "32/34"
  shoes?: string; // e.g. "43"
  suit?: string; // e.g. "52 Drop 6"
}

export interface PastPurchaseItem {
  sku: string;
  name: string;
  category?: string;
  color?: string;
  boughtAt?: string; // ISO date string
}

export interface UserStyleDna {
  tenantSlug: string;
  emailHash: string;
  displayEmail?: string; // e.g. "a***t@gmail.com" (masked)
  
  // KVKK Explicit Consent
  consentGiven: boolean;
  consentDate: string; // ISO date string
  
  // Personal Style Profile
  sizes: UserSizes;
  favoriteColors: string[];
  dislikedStyles: string[];
  styleNotes: string[];
  
  // Purchase & Interaction History
  purchasedItems: PastPurchaseItem[];
  abandonedInterests: string[]; // e.g. items inquired about but not bought
  
  createdAt: string;
  updatedAt: string;
}

export interface MemoryApiResponse {
  active: boolean;
  styleDna?: UserStyleDna | null;
  message?: string;
}
