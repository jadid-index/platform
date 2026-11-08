import type { CvDoc } from "@/lib/types";

// A valid CV body, shared by the CV tests.
export const validCv = (): CvDoc => ({
  about: "Talaba.\nQiziqishlarim: maʼlumotlar tahlili.",
  skills: ["SQL", "Python"],
  languages: [{ name: "Ingliz tili", level: "B2" }],
  experience: [{ title: "Stajyor", organization: "TEST Org", start: "2024-09", end: null, description: "" }],
  links: [{ label: "GitHub", url: "https://github.com/example" }],
  contact_phone: "+998 90 123 45 67",
  contact_email: "Test@Example.invalid",
  contact_telegram: "test_user",
  contact_city: "Toshkent",
});
