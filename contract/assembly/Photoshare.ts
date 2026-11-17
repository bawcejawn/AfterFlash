import { System, Storage, StringBytes, Protobuf, authority } from "@koinos/sdk-as";
import { photoshare } from "./proto/photoshare";

// Storage space ids
const EVENTS_SPACE: u32 = 0;
const KEEPSAKES_SPACE: u32 = 1;
const OWNER_COUNT_SPACE: u32 = 2;
const OWNER_INDEX_SPACE: u32 = 3;

// Limits (bytes). Keep on-chain data small: the chain is a ledger, not a disk.
const MAX_META: i32 = 512;
const MAX_CAPTION: i32 = 140;
const MAX_KEEPSAKE: i32 = 49152; // 48 KiB per keepsake
const MAX_KEEPSAKES_PER_EVENT: u32 = 20000;
const MAX_LIST: u32 = 100;
const ADDRESS_LEN: i32 = 25;

function nb(x: Uint8Array | null): Uint8Array {
  return x ? x : new Uint8Array(0);
}

function ns(x: string | null): string {
  return x ? x : "";
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function u32be(n: u32): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = <u8>((n >> 24) & 0xff);
  out[1] = <u8>((n >> 16) & 0xff);
  out[2] = <u8>((n >> 8) & 0xff);
  out[3] = <u8>(n & 0xff);
  return out;
}

function validEventId(id: string): bool {
  const len = id.length;
  if (len < 4 || len > 40) return false;
  for (let i = 0; i < len; i++) {
    const c = id.charCodeAt(i);
    const ok =
      (c >= 48 && c <= 57) || // 0-9
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      c == 45 || c == 95; // - _
    if (!ok) return false;
  }
  return true;
}

function bytesLen(s: string): i32 {
  return StringBytes.stringToBytes(s).length;
}

function now(): u64 {
  return System.getHeadInfo().head_block_time;
}

function looksLikeImage(mime: string, d: Uint8Array): bool {
  if (d.length < 12) return false;
  if (mime == "image/jpeg") {
    return d[0] == 0xff && d[1] == 0xd8 && d[2] == 0xff;
  }
  if (mime == "image/webp") {
    // "RIFF" .... "WEBP"
    return d[0] == 0x52 && d[1] == 0x49 && d[2] == 0x46 && d[3] == 0x46 &&
      d[8] == 0x57 && d[9] == 0x45 && d[10] == 0x42 && d[11] == 0x50;
  }
  if (mime == "image/avif") {
    // .... "ftyp" "avif"
    return d[4] == 0x66 && d[5] == 0x74 && d[6] == 0x79 && d[7] == 0x70 &&
      d[8] == 0x61 && d[9] == 0x76 && d[10] == 0x69 && d[11] == 0x66;
  }
  return false;
}

export class Photoshare {
  contractId: Uint8Array = System.getContractId();

  events: Storage.Map<Uint8Array, photoshare.event_record> = new Storage.Map(
    this.contractId,
    EVENTS_SPACE,
    photoshare.event_record.decode,
    photoshare.event_record.encode,
    () => new photoshare.event_record()
  );

  keepsakes: Storage.Map<Uint8Array, photoshare.keepsake_record> = new Storage.Map(
    this.contractId,
    KEEPSAKES_SPACE,
    photoshare.keepsake_record.decode,
    photoshare.keepsake_record.encode,
    () => new photoshare.keepsake_record()
  );

  ownerCounts: Storage.Map<Uint8Array, photoshare.owner_count> = new Storage.Map(
    this.contractId,
    OWNER_COUNT_SPACE,
    photoshare.owner_count.decode,
    photoshare.owner_count.encode,
    () => new photoshare.owner_count()
  );

  ownerIndex: Storage.Map<Uint8Array, photoshare.event_ref> = new Storage.Map(
    this.contractId,
    OWNER_INDEX_SPACE,
    photoshare.event_ref.decode,
    photoshare.event_ref.encode,
    () => new photoshare.event_ref()
  );

  private eventKey(owner: Uint8Array, eventId: string): Uint8Array {
    return concat(owner, StringBytes.stringToBytes(eventId));
  }

  private keepsakeKey(owner: Uint8Array, eventId: string, index: u32): Uint8Array {
    const sep = new Uint8Array(1); // 0x00 separator: event ids never contain NUL
    return concat(concat(this.eventKey(owner, eventId), sep), u32be(index));
  }

  private checkOwnerArgs(owner: Uint8Array, eventId: string): void {
    System.require(owner.length == ADDRESS_LEN, "invalid owner address");
    System.require(validEventId(eventId), "invalid event id");
  }

  private requireOwner(owner: Uint8Array): void {
    System.requireAuthority(authority.authorization_type.contract_call, owner);
  }

  private loadExisting(owner: Uint8Array, eventId: string): photoshare.event_record {
    const rec = this.events.get(this.eventKey(owner, eventId))!;
    System.require(rec.exists, "event not found");
    return rec;
  }

  register_event(args: photoshare.register_event_arguments): photoshare.register_event_result {
    const owner = nb(args.owner);
    const eventId = ns(args.event_id);
    this.checkOwnerArgs(owner, eventId);
    System.require(bytesLen(ns(args.meta)) <= MAX_META, "meta too long");
    this.requireOwner(owner);

    const key = this.eventKey(owner, eventId);
    const existing = this.events.get(key)!;
    System.require(!existing.exists, "event already registered");

    const rec = new photoshare.event_record();
    rec.owner = owner;
    rec.event_id = eventId;
    rec.meta = ns(args.meta);
    rec.created_at = now();
    rec.exists = true;
    this.events.put(key, rec);

    const count = this.ownerCounts.get(owner)!;
    this.ownerIndex.put(concat(owner, u32be(count.value)), new photoshare.event_ref(eventId));
    count.value = count.value + 1;
    this.ownerCounts.put(owner, count);

    const ev = new photoshare.event_registered_event(owner, eventId);
    System.event(
      "photoshare.event_registered",
      Protobuf_encode_registered(ev),
      [owner]
    );
    return new photoshare.register_event_result();
  }

  update_meta(args: photoshare.update_meta_arguments): photoshare.update_meta_result {
    const owner = nb(args.owner);
    this.checkOwnerArgs(owner, ns(args.event_id));
    System.require(bytesLen(ns(args.meta)) <= MAX_META, "meta too long");
    this.requireOwner(owner);
    const rec = this.loadExisting(owner, ns(args.event_id));
    rec.meta = ns(args.meta);
    this.events.put(this.eventKey(owner, ns(args.event_id)), rec);
    return new photoshare.update_meta_result();
  }

  anchor_album(args: photoshare.anchor_album_arguments): photoshare.anchor_album_result {
    const owner = nb(args.owner);
    this.checkOwnerArgs(owner, ns(args.event_id));
    System.require(nb(args.album_root).length == 32, "album_root must be 32 bytes");
    System.require(nb(args.manifest_hash).length == 32, "manifest_hash must be 32 bytes");
    this.requireOwner(owner);
    const rec = this.loadExisting(owner, ns(args.event_id));
    rec.album_root = nb(args.album_root);
    rec.manifest_hash = nb(args.manifest_hash);
    rec.photo_count = args.photo_count;
    rec.anchored_at = now();
    rec.anchor_version = rec.anchor_version + 1;
    this.events.put(this.eventKey(owner, ns(args.event_id)), rec);

    const ev = new photoshare.album_anchored_event(owner, ns(args.event_id), nb(args.album_root), rec.anchor_version);
    System.event("photoshare.album_anchored", Protobuf_encode_anchored(ev), [owner]);
    return new photoshare.anchor_album_result(rec.anchor_version);
  }

  add_keepsake(args: photoshare.add_keepsake_arguments): photoshare.add_keepsake_result {
    const owner = nb(args.owner);
    this.checkOwnerArgs(owner, ns(args.event_id));
    System.require(nb(args.data).length > 0 && nb(args.data).length <= MAX_KEEPSAKE, "keepsake must be 1..49152 bytes");
    System.require(looksLikeImage(ns(args.mime), nb(args.data)), "keepsake must be jpeg, webp or avif");
    System.require(bytesLen(ns(args.caption)) <= MAX_CAPTION, "caption too long");
    System.require(nb(args.original_sha256).length == 0 || nb(args.original_sha256).length == 32, "original_sha256 must be 32 bytes");
    this.requireOwner(owner);
    const rec = this.loadExisting(owner, ns(args.event_id));
    System.require(rec.keepsake_count < MAX_KEEPSAKES_PER_EVENT, "keepsake limit reached");

    const index = rec.keepsake_count;
    const k = new photoshare.keepsake_record();
    k.mime = ns(args.mime);
    k.data = nb(args.data);
    k.caption = ns(args.caption);
    k.original_sha256 = nb(args.original_sha256);
    k.added_at = now();
    k.exists = true;
    this.keepsakes.put(this.keepsakeKey(owner, ns(args.event_id), index), k);

    rec.keepsake_count = index + 1;
    this.events.put(this.eventKey(owner, ns(args.event_id)), rec);

    const ev = new photoshare.keepsake_added_event(owner, ns(args.event_id), index);
    System.event("photoshare.keepsake_added", Protobuf_encode_keepsake(ev), [owner]);
    return new photoshare.add_keepsake_result(index);
  }

  remove_keepsake(args: photoshare.remove_keepsake_arguments): photoshare.remove_keepsake_result {
    const owner = nb(args.owner);
    this.checkOwnerArgs(owner, ns(args.event_id));
    this.requireOwner(owner);
    const key = this.keepsakeKey(owner, ns(args.event_id), args.index);
    const k = this.keepsakes.get(key)!;
    System.require(k.exists, "keepsake not found");
    k.data = new Uint8Array(0);
    k.caption = "";
    k.removed = true;
    this.keepsakes.put(key, k);
    return new photoshare.remove_keepsake_result();
  }

  get_event(args: photoshare.get_event_arguments): photoshare.get_event_result {
    const res = new photoshare.get_event_result();
    if (nb(args.owner).length != ADDRESS_LEN || !validEventId(ns(args.event_id))) {
      res.value = new photoshare.event_record();
      return res;
    }
    res.value = this.events.get(this.eventKey(nb(args.owner), ns(args.event_id)))!;
    return res;
  }

  get_keepsake(args: photoshare.get_keepsake_arguments): photoshare.get_keepsake_result {
    const res = new photoshare.get_keepsake_result();
    if (nb(args.owner).length != ADDRESS_LEN || !validEventId(ns(args.event_id))) {
      res.value = new photoshare.keepsake_record();
      return res;
    }
    res.value = this.keepsakes.get(this.keepsakeKey(nb(args.owner), ns(args.event_id), args.index))!;
    return res;
  }

  list_events(args: photoshare.list_events_arguments): photoshare.list_events_result {
    const res = new photoshare.list_events_result();
    if (nb(args.owner).length != ADDRESS_LEN) return res;
    const total = this.ownerCounts.get(nb(args.owner))!.value;
    res.total = total;
    let limit: u32 = args.limit == 0 ? <u32>20 : args.limit;
    if (limit > MAX_LIST) limit = MAX_LIST;
    const ids = new Array<string>();
    for (let i: u32 = args.start; i < total && i < args.start + limit; i++) {
      const ref = this.ownerIndex.get(concat(nb(args.owner), u32be(i)));
      if (ref) ids.push(ns(ref.event_id));
    }
    res.event_ids = ids;
    return res;
  }
}

// small helpers so the event encoders stay readable
function Protobuf_encode_registered(e: photoshare.event_registered_event): Uint8Array {
  return Protobuf.encode(e, photoshare.event_registered_event.encode);
}
function Protobuf_encode_anchored(e: photoshare.album_anchored_event): Uint8Array {
  return Protobuf.encode(e, photoshare.album_anchored_event.encode);
}
function Protobuf_encode_keepsake(e: photoshare.keepsake_added_event): Uint8Array {
  return Protobuf.encode(e, photoshare.keepsake_added_event.encode);
}
