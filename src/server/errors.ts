/** A problem with what the user submitted (bad file, missing mapping). Safe to show as-is. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
