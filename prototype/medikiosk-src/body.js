/* Body map: the provided front-view anatomy photo with tappable regions.
   Regions are positioned in fractions of the image so they scale with it.
   The photo bytes are injected at build time by replacing __ANATOMY_IMAGE__
   with a data URI (see build-prototype.py), keeping the shipped file
   self-contained. Region ids match the bodymap vocabulary used elsewhere. */

const MK_BODY_REGIONS = [
  { id: "head",    label: "Head",           left: 0.40, top: 0.04, width: 0.20, height: 0.17 },
  { id: "chest",   label: "Chest",          left: 0.29, top: 0.22, width: 0.42, height: 0.17 },
  { id: "abdomen", label: "Belly",          left: 0.29, top: 0.39, width: 0.42, height: 0.17 },
  { id: "armL",    label: "Left arm",       left: 0.18, top: 0.24, width: 0.11, height: 0.36 },
  { id: "armR",    label: "Right arm",      left: 0.71, top: 0.24, width: 0.11, height: 0.36 },
  { id: "legL",    label: "Left leg",       left: 0.32, top: 0.57, width: 0.17, height: 0.38 },
  { id: "legR",    label: "Right leg",      left: 0.51, top: 0.57, width: 0.17, height: 0.38 },
];

function mkBodyHtml(selectedId) {
  const spots = MK_BODY_REGIONS.map((r) => {
    const sel = selectedId === r.id ? " sel" : "";
    const style = "left:" + (r.left * 100) + "%;top:" + (r.top * 100)
      + "%;width:" + (r.width * 100) + "%;height:" + (r.height * 100) + "%";
    return '<button type="button" class="anatomyHot' + sel + '" data-region="' + r.id
      + '" style="' + style + '" aria-label="' + r.label + '">'
      + '<span class="anatomyLbl">' + r.label + "</span></button>";
  }).join("");
  return '<div class="anatomyWrap">'
    + '<img class="anatomyImg" src="__ANATOMY_IMAGE__" alt="Human body picture — tap where it hurts" />'
    + spots + "</div>";
}
