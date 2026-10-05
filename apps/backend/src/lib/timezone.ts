import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Lead time zone resolution: the lead's own field if valid, else derived from the phone number
 * (NANP area code, or the country for single-time-zone countries), else the campaign time zone.
 */

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const AREA_CODES: Record<string, string> = {};
function zone(tz: string, codes: string) {
  for (const c of codes.split(/\s+/).filter(Boolean)) AREA_CODES[c] = tz;
}

// United States
zone('America/New_York', `
  203 475 860 959 302 202 771 239 305 321 352 386 407 561 656 689 727 754 772 786 813 863 904 941 954
  229 404 470 478 678 706 762 770 912 943 502 606 859 207 240 301 410 443 667 339 351 413 508 617 774 781 857 978
  603 201 551 609 640 732 848 856 862 908 973 212 315 332 347 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934
  252 336 704 743 828 910 919 980 984 216 220 234 326 330 380 419 440 513 567 614 740 937
  215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 401 803 839 843 854 864 423 865 802
  276 434 540 571 703 757 804 826 948 304 681`);
zone('America/Detroit', '231 248 269 313 517 586 616 679 734 810 906 947 989');
zone('America/Indiana/Indianapolis', '260 317 463 574 765 812 930');
zone('America/Chicago', `
  205 251 256 334 659 938 479 501 870 217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 872
  319 515 563 641 712 316 620 785 913 225 318 337 504 985 218 320 507 612 651 763 952 228 601 662 769
  314 417 557 573 636 660 816 975 308 402 531 701 405 539 572 580 918 605
  210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979
  262 274 414 534 608 715 920 615 629 731 901 931 270 364 850 448 219`);
zone('America/Denver', '303 719 720 970 983 406 505 575 385 435 801 307 915');
zone('America/Boise', '208 986');
zone('America/Phoenix', '480 520 602 623 928');
zone('America/Los_Angeles', `
  209 213 279 310 323 341 350 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760
  805 818 820 831 840 858 909 916 925 949 951 702 725 775 458 503 541 971 206 253 360 425 509 564`);
zone('America/Anchorage', '907');
zone('Pacific/Honolulu', '808');
zone('America/Puerto_Rico', '787 939');
// Canada
zone('America/Toronto', `
  226 249 289 343 365 382 416 437 519 548 613 647 683 705 742 753 807 905
  263 354 367 418 438 450 468 514 579 581 819 873`);
zone('America/Halifax', '902 782 506');
zone('America/St_Johns', '709');
zone('America/Winnipeg', '204 431 584');
zone('America/Regina', '306 474 639');
zone('America/Edmonton', '368 403 587 780 825');
zone('America/Vancouver', '236 250 604 672 778');

/** Countries that use a single time zone. Multi-zone countries fall back to the campaign zone. */
const COUNTRY_ZONES: Record<string, string> = {
  GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', DE: 'Europe/Berlin', ES: 'Europe/Madrid',
  IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna',
  SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague', GR: 'Europe/Athens', RO: 'Europe/Bucharest', HU: 'Europe/Budapest',
  IN: 'Asia/Kolkata', SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  CN: 'Asia/Shanghai', PH: 'Asia/Manila', PK: 'Asia/Karachi', AE: 'Asia/Dubai', IL: 'Asia/Jerusalem',
  SA: 'Asia/Riyadh', NZ: 'Pacific/Auckland', ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi',
  EG: 'Africa/Cairo', CO: 'America/Bogota', PE: 'America/Lima', CL: 'America/Santiago', AR: 'America/Argentina/Buenos_Aires',
};

export function timeZoneFromPhone(phoneE164: string | null | undefined): string | null {
  if (!phoneE164) return null;
  const parsed = parsePhoneNumberFromString(phoneE164);
  if (!parsed) return null;
  if (parsed.countryCallingCode === '1') {
    const area = parsed.nationalNumber.slice(0, 3);
    return AREA_CODES[area] ?? null;
  }
  const country = parsed.country;
  return country ? (COUNTRY_ZONES[country] ?? null) : null;
}

export type TimeZoneSource = 'lead' | 'phone' | 'campaign';

export function resolveLeadTimeZone(input: {
  leadTimeZone?: string | null;
  phoneE164?: string | null;
  campaignTimeZone: string;
}): { timeZone: string; source: TimeZoneSource } {
  if (isValidTimeZone(input.leadTimeZone)) return { timeZone: input.leadTimeZone, source: 'lead' };
  const fromPhone = timeZoneFromPhone(input.phoneE164);
  if (fromPhone) return { timeZone: fromPhone, source: 'phone' };
  return { timeZone: input.campaignTimeZone, source: 'campaign' };
}
