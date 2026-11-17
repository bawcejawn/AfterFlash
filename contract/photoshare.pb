
Ÿ
assembly/proto/photoshare.proto
photosharekoinos/options.proto"ü
event_record
owner (B€µRowner
event_id (	ReventId
meta (	Rmeta!

created_at (B0R	createdAt#

album_root (B€µR	albumRoot)
manifest_hash (B€µRmanifestHash#
photo_count (B0R
photoCount#
anchored_at (B0R
anchoredAt%
anchor_version	 (RanchorVersion%
keepsake_count
 (RkeepsakeCount
exists (Rexists"Ó
keepsake_record
mime (	Rmime
data (Rdata
caption (	Rcaption-
original_sha256 (B€µRoriginalSha256
added_at (B0RaddedAt
exists (Rexists
removed (Rremoved"#
owner_count
value (Rvalue"&
	event_ref
event_id (	ReventId"e
register_event_arguments
owner (B€µRowner
event_id (	ReventId
meta (	Rmeta"
register_event_result"b
update_meta_arguments
owner (B€µRowner
event_id (	ReventId
meta (	Rmeta"
update_meta_result"Ä
anchor_album_arguments
owner (B€µRowner
event_id (	ReventId#

album_root (B€µR	albumRoot)
manifest_hash (B€µRmanifestHash#
photo_count (B0R
photoCount"<
anchor_album_result%
anchor_version (RanchorVersion"À
add_keepsake_arguments
owner (B€µRowner
event_id (	ReventId
mime (	Rmime
data (Rdata
caption (	Rcaption-
original_sha256 (B€µRoriginalSha256"+
add_keepsake_result
index (Rindex"h
remove_keepsake_arguments
owner (B€µRowner
event_id (	ReventId
index (Rindex"
remove_keepsake_result"L
get_event_arguments
owner (B€µRowner
event_id (	ReventId"B
get_event_result.
value (2.photoshare.event_recordRvalue"e
get_keepsake_arguments
owner (B€µRowner
event_id (	ReventId
index (Rindex"H
get_keepsake_result1
value (2.photoshare.keepsake_recordRvalue"_
list_events_arguments
owner (B€µRowner
start (Rstart
limit (Rlimit"G
list_events_result
	event_ids (	ReventIds
total (Rtotal"O
event_registered_event
owner (B€µRowner
event_id (	ReventId"™
album_anchored_event
owner (B€µRowner
event_id (	ReventId#

album_root (B€µR	albumRoot%
anchor_version (RanchorVersion"c
keepsake_added_event
owner (B€µRowner
event_id (	ReventId
index (Rindexbproto3