package com.shmamsa.util;

import java.time.LocalDate;

/**
 * Utilities for Egyptian National ID (14 digits).
 * - Birth date: digits 1..7 (century + yy + mm + dd)
 * - Gender: digit 13 (index 12) -> odd = MALE, even = FEMALE
 */
public final class NationalIdUtils {

    private NationalIdUtils() {}

    public static LocalDate extractBirthDate(String nid) {
        if (nid == null || !nid.matches("\\d{14}")) return null;

        int century;
        char c = nid.charAt(0);
        if (c == '2') century = 1900;
        else if (c == '3') century = 2000;
        else return null;

        int year = century + Integer.parseInt(nid.substring(1, 3));
        int month = Integer.parseInt(nid.substring(3, 5));
        int day = Integer.parseInt(nid.substring(5, 7));

        try {
            return LocalDate.of(year, month, day);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * @return "MALE" or "FEMALE" or null if invalid
     */
    public static String extractGender(String nid) {
        if (nid == null || !nid.matches("\\d{14}")) return null;
        int genderDigit = Character.getNumericValue(nid.charAt(12)); // 13th digit
        return (genderDigit % 2 == 0) ? "FEMALE" : "MALE";
    }
}
