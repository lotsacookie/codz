// Wall buys are drawn from the map's weapon world models, which carry every attachment (extended mags, grips,
// stocks). The wall should show the plain weapon, so hide the same tags the viewmodel and mystery box hide.
export function hideWallGunAttachments(root, weapon) {
  const tags = weapon?.hideTags;
  if (!root || !tags?.length) return 0;
  let hidden = 0;
  root.traverse(node => {
    if (!node.name || !tags.some(tag => node.name === tag || node.name.startsWith(tag + '_') && /^\d+$/.test(node.name.slice(tag.length + 1)))) return;
    node.scale.setScalar(.000001);
    node.userData.hiddenAttachment = true;
    hidden++;
  });
  return hidden;
}
