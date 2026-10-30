export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateSignUp(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}): string | undefined {
  if (input.name.trim().length === 0) {
    return 'Name is required.';
  }

  if (!isValidEmail(input.email.trim())) {
    return 'Enter a valid email address.';
  }

  if (input.password.length < 6) {
    return 'Password must be at least 6 characters.';
  }

  if (input.password !== input.confirmPassword) {
    return 'Passwords must match.';
  }

  return undefined;
}

export function validateSignIn(input: { email: string; password: string }): string | undefined {
  if (!isValidEmail(input.email.trim())) {
    return 'Enter a valid email address.';
  }

  if (input.password.length === 0) {
    return 'Password is required.';
  }

  return undefined;
}
