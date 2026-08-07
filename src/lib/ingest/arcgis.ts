/**
 * Generic ArcGIS REST client.  (Ingestion layer, step 1 of 3)
 *
 * Knows nothing about parcels, zoning, or any particular city. It knows how to
 * read an ArcGIS Server / ArcGIS Online feature layer politely and completely:
 * metadata, field introspection, feature counts, and paged `/query` output as
 * GeoJSON in EPSG:4326.
 *
 * WHY THIS IS DELIBERATELY CONSERVATIVE
 * -------------------------------------
 * The other end of every one of these requests is a municipal GIS server —
 * frequently a single VM, funded by a city of 130,000 people, that also serves
 * the public map viewer their own planning department uses. A naive ingestion
 * loop with unbounded concurrency and no backoff is indistinguishable from a
 * denial-of-service, and the realistic consequence is that a city blocks us and
 * a coverage area disappears. So:
 *
 *   - Concurrency is clamped to `MAX_CONCURRENCY` (3), default 2.
 *   - A minimum interval separates request *starts*, so a burst can't stack up.
 *   - Backoff is exponential with jitter, and `Retry-After` is honoured.
 *   - `maxPages` / `maxRecords` are HARD caps. A paging bug that would
 *     otherwise loop forever throws instead of hammering the server.
 *   - The User-Agent identifies the caller and carries a contact URL, so a
 *     sysadmin who sees us in their logs can find out who we are.
 *
 * NOTHING IN HERE RETRIES FOREVER and nothing in here runs unbounded.
 */

/** Field types as reported by the ArcGIS REST `fields` array. */
export type EsriFieldType =
  | "esriFieldTypeOID"
  | "esriFieldTypeSmallInteger"
  | "esriFieldTypeInteger"
  | "esriFieldTypeBigInteger"
  | "esriFieldTypeSingle"
  | "esriFieldTypeDouble"
  | "esriFieldTypeString"
  | "esriFieldTypeDate"
  | "esriFieldTypeDateOnly"
  | "esriFieldTypeTimeOnly"
  | "esriFieldTypeTimestampOffset"
  | "esriFieldTypeGeometry"
  | "esriFieldTypeBlob"
  | "esriFieldTypeRaster"
  | "esriFieldTypeGUID"
  | "esriFieldTypeGlobalID"
  | "esriFieldTypeXML";

export type ArcGisField = {
  name: string;
  type: EsriFieldType | string;
  alias?: string;
  length?: number;
  domain?: unknown;
};

export type ArcGisLayerMetadata = {
  id: number;
  name: string;
  /** 'Feature Layer' | 'Table' | ... */
  type: string;
  geometryType?: string;
  /** Server-declared page ceiling. Never ask for more than this. */
  maxRecordCount: number;
  fields: ArcGisField[];
  objectIdField: string | null;
  supportsPagination: boolean;
  /** Well-known id of the layer's native spatial reference, when declared. */
  spatialReferenceWkid: number | null;
  /** The URL this metadata was read from, normalised (no trailing slash). */
  url: string;
};

export type ArcGisServiceLayerSummary = {
  id: number;
  name: string;
  type: string;
  geometryType?: string;
};

export type ArcGisServiceMetadata = {
  url: string;
  serviceDescription: string | null;
  maxRecordCount: number | null;
  layers: ArcGisServiceLayerSummary[];
  tables: ArcGisServiceLayerSummary[];
};

/** Minimal GeoJSON shapes. Deliberately loose — we re-serialise, not interpret. */
export type GeoJsonGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};

export type GeoJsonFeature = {
  type: "Feature";
  id?: string | number;
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
};

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
  exceededTransferLimit?: boolean;
};

export type ArcGisPage = {
  /** 0-based page index within this query. */
  pageIndex: number;
  /** `resultOffset` used for this page. */
  offset: number;
  features: GeoJsonFeature[];
  /** Server said there is more beyond this page. */
  exceededTransferLimit: boolean;
};

export type ArcGisQueryParams = {
  /** SQL-ish predicate. Defaults to `1=1`. */
  where?: string;
  /** Comma-separated field list, or `*`. Defaults to `*`. */
  outFields?: string;
  returnGeometry?: boolean;
  /** Requested page size. Silently clamped to the layer's `maxRecordCount`. */
  pageSize?: number;
  /** Deterministic paging needs a stable sort; defaults to the OID field. */
  orderByFields?: string;
  /** Extra raw query-string parameters, escape hatch for odd services. */
  extra?: Record<string, string>;
};

export type ArcGisClientOptions = {
  /** Sent on every request. Must identify the caller. */
  userAgent?: string;
  /** Total attempts per request, including the first. Default 4. */
  maxAttempts?: number;
  /** First retry delay in ms; doubles with jitter. Default 800. */
  baseBackoffMs?: number;
  /** Ceiling for a single backoff sleep. Default 30_000. */
  maxBackoffMs?: number;
  /** Per-request timeout in ms. Default 90_000. */
  requestTimeoutMs?: number;
  /** In-flight request ceiling. Clamped to [1, 3]. Default 2. */
  concurrency?: number;
  /** Minimum ms between request *starts*. Default 120. */
  minRequestIntervalMs?: number;
  /** HARD cap on pages per query. Default 10_000. Exceeding it throws. */
  maxPages?: number;
  /** HARD cap on features per query. Default 5_000_000. Exceeding it throws. */
  maxRecords?: number;
  /** Progress callback, invoked once per completed page. */
  onProgress?: (info: {
    pageIndex: number;
    fetched: number;
    total: number | null;
  }) => void;
  /** Diagnostics sink. Defaults to no-op. */
  onLog?: (level: "info" | "warn", message: string) => void;
};

const MAX_CONCURRENCY = 3;

const DEFAULTS = {
  userAgent:
    "RealestateGenius-Ingest/1.0 (public-records ingestion; +https://realestate-genius.netlify.app)",
  maxAttempts: 4,
  baseBackoffMs: 800,
  maxBackoffMs: 30_000,
  requestTimeoutMs: 90_000,
  concurrency: 2,
  minRequestIntervalMs: 120,
  maxPages: 10_000,
  maxRecords: 5_000_000,
} as const;

/** A failure that carries enough context to decide whether to retry. */
export class ArcGisError extends Error {
  readonly url: string;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { url: string; status?: number | null; retryable?: boolean },
  ) {
    super(message);
    this.name = "ArcGisError";
    this.url = opts.url;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

type ResolvedOptions = Required<Omit<ArcGisClientOptions, "onProgress" | "onLog">> & {
  onProgress: NonNullable<ArcGisClientOptions["onProgress"]> | null;
  onLog: NonNullable<ArcGisClientOptions["onLog"]>;
};

function resolveOptions(opts: ArcGisClientOptions | undefined): ResolvedOptions {
  const o = opts ?? {};
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, o.concurrency ?? DEFAULTS.concurrency));
  return {
    userAgent: o.userAgent ?? DEFAULTS.userAgent,
    maxAttempts: Math.max(1, o.maxAttempts ?? DEFAULTS.maxAttempts),
    baseBackoffMs: o.baseBackoffMs ?? DEFAULTS.baseBackoffMs,
    maxBackoffMs: o.maxBackoffMs ?? DEFAULTS.maxBackoffMs,
    requestTimeoutMs: o.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    concurrency,
    minRequestIntervalMs: o.minRequestIntervalMs ?? DEFAULTS.minRequestIntervalMs,
    maxPages: o.maxPages ?? DEFAULTS.maxPages,
    maxRecords: o.maxRecords ?? DEFAULTS.maxRecords,
    onProgress: o.onProgress ?? null,
    onLog: o.onLog ?? (() => {}),
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Serialises request *starts* so no more than `concurrency` are in flight and
 * no two start closer together than `minIntervalMs`. Shared per client so a
 * caller running several queries at once still cannot exceed the budget.
 */
class PoliteGate {
  private active = 0;
  private lastStart = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly concurrency: number;
  private readonly minIntervalMs: number;

  // Written out longhand rather than as constructor parameter properties:
  // those are not erasable TypeScript, and `scripts/ingest.mjs` imports this
  // module through Node's strip-only type stripping.
  constructor(concurrency: number, minIntervalMs: number) {
    this.concurrency = concurrency;
    this.minIntervalMs = minIntervalMs;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;

    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStart = Date.now();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

/** Retryable HTTP statuses. 4xx other than 408/429 means "we asked wrong". */
function statusIsRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class ArcGisClient {
  private readonly opts: ResolvedOptions;
  private readonly gate: PoliteGate;

  constructor(options?: ArcGisClientOptions) {
    this.opts = resolveOptions(options);
    this.gate = new PoliteGate(this.opts.concurrency, this.opts.minRequestIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  /** One HTTP GET with timeout, politeness gating, and bounded retry. */
  private async getJson(url: string): Promise<Record<string, unknown>> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= this.opts.maxAttempts; attempt += 1) {
      const release = await this.gate.acquire();
      let retryAfterMs: number | null = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.opts.requestTimeoutMs);
        let res: Response;
        try {
          res = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            headers: {
              "User-Agent": this.opts.userAgent,
              Accept: "application/json",
              // Municipal servers frequently sit behind a gzip-capable proxy;
              // parcel GeoJSON compresses ~8:1 and this is a real courtesy.
              "Accept-Encoding": "gzip, deflate",
            },
          });
        } finally {
          clearTimeout(timer);
        }

        if (!res.ok) {
          const retryable = statusIsRetryable(res.status);
          const header = res.headers.get("retry-after");
          if (header) {
            const secs = Number(header);
            if (Number.isFinite(secs)) retryAfterMs = Math.min(secs * 1000, this.opts.maxBackoffMs);
          }
          const body = await res.text().catch(() => "");
          throw new ArcGisError(
            `HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`,
            { url, status: res.status, retryable },
          );
        }

        const text = await res.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // ArcGIS servers under load return an HTML error page with HTTP 200.
          throw new ArcGisError(
            `Response was not JSON (first 200 chars: ${text.slice(0, 200)})`,
            { url, status: res.status, retryable: true },
          );
        }

        if (parsed === null || typeof parsed !== "object") {
          throw new ArcGisError("Response JSON was not an object", { url, retryable: false });
        }

        const obj = parsed as Record<string, unknown>;
        // ArcGIS signals application errors inside a 200 body.
        const err = obj.error as { code?: number; message?: string; details?: string[] } | undefined;
        if (err) {
          const code = err.code ?? 0;
          throw new ArcGisError(
            `ArcGIS error ${code}: ${err.message ?? "unknown"}${
              err.details?.length ? ` (${err.details.join("; ")})` : ""
            }`,
            { url, status: code, retryable: code === 429 || code >= 500 },
          );
        }

        return obj;
      } catch (e) {
        lastError = e;
        const retryable =
          e instanceof ArcGisError
            ? e.retryable
            : // AbortError / ECONNRESET / DNS blips are all worth one more go.
              true;
        if (!retryable || attempt === this.opts.maxAttempts) break;

        const backoff =
          retryAfterMs ??
          Math.min(
            this.opts.maxBackoffMs,
            this.opts.baseBackoffMs * 2 ** (attempt - 1),
          );
        // Full jitter: avoids a synchronised retry storm across parallel pages.
        const delay = Math.round(backoff * (0.5 + Math.random() * 0.5));
        this.opts.onLog(
          "warn",
          `attempt ${attempt}/${this.opts.maxAttempts} failed (${
            e instanceof Error ? e.message : String(e)
          }); retrying in ${delay}ms`,
        );
        await sleep(delay);
      } finally {
        release();
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new ArcGisError("Request failed for an unknown reason", { url });
  }

  // -------------------------------------------------------------------------
  // Metadata + introspection
  // -------------------------------------------------------------------------

  /** Service-level metadata: which layers exist, and their ids. */
  async fetchServiceMetadata(serviceUrl: string): Promise<ArcGisServiceMetadata> {
    const url = `${trimUrl(serviceUrl)}?f=json`;
    const json = await this.getJson(url);
    const toSummary = (v: unknown): ArcGisServiceLayerSummary[] =>
      Array.isArray(v)
        ? v.map((l) => {
            const o = l as Record<string, unknown>;
            return {
              id: Number(o.id),
              name: String(o.name ?? ""),
              type: String(o.type ?? ""),
              geometryType: typeof o.geometryType === "string" ? o.geometryType : undefined,
            };
          })
        : [];
    return {
      url: trimUrl(serviceUrl),
      serviceDescription:
        typeof json.serviceDescription === "string" ? json.serviceDescription : null,
      maxRecordCount:
        typeof json.maxRecordCount === "number" ? json.maxRecordCount : null,
      layers: toSummary(json.layers),
      tables: toSummary(json.tables),
    };
  }

  /**
   * Layer metadata including the full field list. This is the input to
   * `detectFieldMapping()` in ./mapping — onboarding a new jurisdiction starts
   * here.
   */
  async fetchLayerMetadata(
    serviceUrl: string,
    layerId: number,
  ): Promise<ArcGisLayerMetadata> {
    const layerUrl = `${trimUrl(serviceUrl)}/${layerId}`;
    const json = await this.getJson(`${layerUrl}?f=json`);

    const fields: ArcGisField[] = Array.isArray(json.fields)
      ? json.fields.map((f) => {
          const o = f as Record<string, unknown>;
          return {
            name: String(o.name ?? ""),
            type: String(o.type ?? ""),
            alias: typeof o.alias === "string" ? o.alias : undefined,
            length: typeof o.length === "number" ? o.length : undefined,
            domain: o.domain ?? undefined,
          };
        })
      : [];

    const adv = (json.advancedQueryCapabilities ?? {}) as Record<string, unknown>;
    const extent = (json.extent ?? {}) as Record<string, unknown>;
    const sr = (extent.spatialReference ?? {}) as Record<string, unknown>;

    const oidFromFields = fields.find((f) => f.type === "esriFieldTypeOID")?.name ?? null;

    return {
      id: typeof json.id === "number" ? json.id : layerId,
      name: String(json.name ?? `layer_${layerId}`),
      type: String(json.type ?? "unknown"),
      geometryType: typeof json.geometryType === "string" ? json.geometryType : undefined,
      maxRecordCount:
        typeof json.maxRecordCount === "number" && json.maxRecordCount > 0
          ? json.maxRecordCount
          : 1000,
      fields,
      objectIdField:
        (typeof json.objectIdField === "string" ? json.objectIdField : null) ?? oidFromFields,
      supportsPagination: adv.supportsPagination === true,
      spatialReferenceWkid:
        typeof sr.latestWkid === "number"
          ? sr.latestWkid
          : typeof sr.wkid === "number"
            ? sr.wkid
            : null,
      url: layerUrl,
    };
  }

  /** `returnCountOnly` — one cheap request, and the basis for paging maths. */
  async countFeatures(
    serviceUrl: string,
    layerId: number,
    where = "1=1",
  ): Promise<number> {
    const url =
      `${trimUrl(serviceUrl)}/${layerId}/query?` +
      new URLSearchParams({ where, returnCountOnly: "true", f: "json" }).toString();
    const json = await this.getJson(url);
    const n = Number(json.count);
    if (!Number.isFinite(n)) {
      throw new ArcGisError("returnCountOnly did not produce a count", { url });
    }
    return n;
  }

  // -------------------------------------------------------------------------
  // Paged query
  // -------------------------------------------------------------------------

  /**
   * Stream a whole layer as GeoJSON pages in EPSG:4326.
   *
   * Paging strategy:
   *   - When the server supports pagination AND `returnCountOnly` gave us a
   *     total, offsets are computed up front and fetched `concurrency` at a
   *     time, yielded in order. Deterministic and bounded.
   *   - Otherwise it degrades to strictly sequential paging driven by
   *     `exceededTransferLimit`.
   *
   * Both paths are governed by `maxPages` / `maxRecords`; blowing either throws
   * rather than continuing to hit the server.
   */
  async *queryPages(
    serviceUrl: string,
    layerId: number,
    params: ArcGisQueryParams = {},
    meta?: ArcGisLayerMetadata,
  ): AsyncGenerator<ArcGisPage, void, undefined> {
    const layerMeta = meta ?? (await this.fetchLayerMetadata(serviceUrl, layerId));
    const where = params.where ?? "1=1";
    const pageSize = Math.max(
      1,
      Math.min(params.pageSize ?? layerMeta.maxRecordCount, layerMeta.maxRecordCount),
    );
    const orderBy =
      params.orderByFields ?? (layerMeta.objectIdField ? layerMeta.objectIdField : "");

    const buildUrl = (offset: number): string => {
      const qs = new URLSearchParams({
        where,
        outFields: params.outFields ?? "*",
        // 4326 regardless of the layer's native SR. Fargo publishes 3857;
        // reprojecting server-side is free and keeps the DB in one CRS.
        outSR: "4326",
        f: "geojson",
        returnGeometry: String(params.returnGeometry ?? true),
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
      });
      if (orderBy) qs.set("orderByFields", orderBy);
      for (const [k, v] of Object.entries(params.extra ?? {})) qs.set(k, v);
      return `${trimUrl(serviceUrl)}/${layerId}/query?${qs.toString()}`;
    };

    const readPage = async (offset: number, pageIndex: number): Promise<ArcGisPage> => {
      const json = (await this.getJson(buildUrl(offset))) as unknown as GeoJsonFeatureCollection;
      const features = Array.isArray(json.features) ? json.features : [];
      return {
        pageIndex,
        offset,
        features,
        exceededTransferLimit: json.exceededTransferLimit === true,
      };
    };

    let total: number | null = null;
    if (layerMeta.supportsPagination) {
      try {
        total = await this.countFeatures(serviceUrl, layerId, where);
      } catch (e) {
        this.opts.onLog(
          "warn",
          `count failed, falling back to sequential paging: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    let fetched = 0;
    let pageIndex = 0;

    if (total !== null) {
      const pageCount = Math.ceil(total / pageSize);
      this.assertPageBudget(pageCount);

      for (let i = 0; i < pageCount; i += this.opts.concurrency) {
        const batch: Array<Promise<ArcGisPage>> = [];
        for (let k = 0; k < this.opts.concurrency && i + k < pageCount; k += 1) {
          const idx = i + k;
          batch.push(readPage(idx * pageSize, idx));
        }
        const pages = await Promise.all(batch);
        for (const page of pages) {
          fetched += page.features.length;
          pageIndex += 1;
          this.assertRecordBudget(fetched);
          this.opts.onProgress?.({ pageIndex: page.pageIndex, fetched, total });
          yield page;
        }
      }
      return;
    }

    // Sequential fallback: no count, or pagination unsupported.
    let offset = 0;
    for (;;) {
      this.assertPageBudget(pageIndex + 1);
      const page = await readPage(offset, pageIndex);
      fetched += page.features.length;
      this.assertRecordBudget(fetched);
      this.opts.onProgress?.({ pageIndex, fetched, total: null });
      yield page;

      if (page.features.length === 0) return;
      if (!page.exceededTransferLimit && page.features.length < pageSize) return;
      offset += page.features.length;
      pageIndex += 1;
      // A server that ignores resultOffset would return the same page forever.
      if (page.features.length === 0) return;
    }
  }

  /** Convenience: collect every feature into memory. Respects the same caps. */
  async queryAll(
    serviceUrl: string,
    layerId: number,
    params: ArcGisQueryParams = {},
    meta?: ArcGisLayerMetadata,
  ): Promise<GeoJsonFeature[]> {
    const out: GeoJsonFeature[] = [];
    for await (const page of this.queryPages(serviceUrl, layerId, params, meta)) {
      out.push(...page.features);
    }
    return out;
  }

  private assertPageBudget(pages: number): void {
    if (pages > this.opts.maxPages) {
      throw new ArcGisError(
        `Refusing to fetch ${pages} pages: exceeds maxPages=${this.opts.maxPages}. ` +
          `Either the layer is far larger than expected or paging is not advancing. ` +
          `Raise maxPages deliberately if this is real.`,
        { url: "(paging budget)" },
      );
    }
  }

  private assertRecordBudget(records: number): void {
    if (records > this.opts.maxRecords) {
      throw new ArcGisError(
        `Refusing to fetch more than maxRecords=${this.opts.maxRecords} features ` +
          `(already at ${records}). This guard exists so a paging bug cannot ` +
          `hammer a government server.`,
        { url: "(record budget)" },
      );
    }
  }
}

/** Strip a trailing slash so `${url}/${id}` never doubles up. */
export function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * ArcGIS date fields are epoch milliseconds (UTC). Returns `YYYY-MM-DD`, or
 * null for the sentinel values services use in place of "no date".
 */
export function esriDateToIsoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms === 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  // Guard against 1899/1970 placeholders and obvious garbage.
  if (year < 1800 || year > 2200) return null;
  return d.toISOString().slice(0, 10);
}
