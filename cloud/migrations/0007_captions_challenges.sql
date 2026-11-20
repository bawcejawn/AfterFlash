-- Photo captions (typed by the guest) and photo challenges (the host's prompt the photo answers).
ALTER TABLE media ADD COLUMN caption TEXT DEFAULT '';
ALTER TABLE media ADD COLUMN challenge TEXT DEFAULT '';
