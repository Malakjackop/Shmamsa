package com.shmamsa.util;

import java.time.LocalDate;


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

    public static String extractGender(String nid) {
        if (nid == null || !nid.matches("\\d{14}")) return null;
        int genderDigit = Character.getNumericValue(nid.charAt(12)); 
        return (genderDigit % 2 == 0) ? "FEMALE" : "MALE";
    }
}
