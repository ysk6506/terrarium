/** Saves a text as a file from the browser, with no server round trip. */
export function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // the browser reads the blob after the click, so let go of it a little later
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
