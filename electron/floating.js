async function refresh() {
  const data = await window.floating.data();
  document.querySelector("#preview").hidden = data.kind !== "preview";
  document.querySelector("#recorder").hidden = data.kind !== "recorder";
  if (data.kind === "recorder") {
    document.querySelector("#time").textContent =
      Math.floor(data.seconds / 60)
        .toString()
        .padStart(2, "0") +
      ":" +
      (data.seconds % 60).toString().padStart(2, "0");
    document.querySelector("#state").textContent =
      data.state === "paused"
        ? "Paused"
        : data.state === "saving"
          ? "Saving…"
          : data.state === "preparing"
            ? data.seconds
              ? "Starting…"
              : "Preparing…"
            : "Recording";
    document.querySelector("#pause").textContent =
      data.state === "paused" ? "Resume" : "Pause";
    document
      .querySelector("#pause")
      .setAttribute(
        "aria-label",
        data.state === "paused" ? "Resume recording" : "Pause recording",
      );
    document.querySelector("#pause").disabled = ![
      "recording",
      "paused",
    ].includes(data.state);
    document.querySelector("#stop").disabled = ![
      "recording",
      "paused",
      "preparing",
    ].includes(data.state);
    document.querySelector("#stop").textContent =
      data.state === "preparing" ? "Cancel" : "Stop";
  } else {
    document.querySelector("#name").textContent = data.name;
    document.querySelector("#image").src = data.image;
    document.querySelector("#copy").hidden = data.video;
    document.querySelector("#format").hidden = !data.video;
    document.querySelector("#format").value = data.format;
    document.querySelector("#edit").textContent = data.video ? "Play" : "Edit";
    document.querySelector("#pin").hidden = data.video;
    document.querySelector("#pin").textContent = data.pinned ? "Unpin" : "Pin";
  }
}
for (const button of document.querySelectorAll("button"))
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await window.floating.action(
        button.id === "export" && !document.querySelector("#format").hidden
          ? "export:" + document.querySelector("#format").value
          : button.id,
      );
      if (button.id === "copy" && result) button.textContent = "Copied";
    } catch (error) {
      document.querySelector("#error").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape")
    window.floating.action(
      document.querySelector("#recorder").hidden ? "close" : "hide",
    );
});
window.floating.onUpdate(() => refresh().catch(() => {}));
refresh().catch(
  (error) => (document.querySelector("#error").textContent = error.message),
);
