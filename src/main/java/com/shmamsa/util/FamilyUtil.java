package com.shmamsa.util;

import java.util.ArrayList;
import java.util.List;

public class FamilyUtil {

    private static final String A = " أ";
    private static final String B = " ب";

    public static String mainFamily(String family) {
        if (family == null) return null;
        String f = family.trim();
        if (f.endsWith(A)) return f.substring(0, f.length() - A.length()).trim();
        if (f.endsWith(B)) return f.substring(0, f.length() - B.length()).trim();
        return f;
    }

    public static List<String> variantsPlusAll(String family) {
        String base = mainFamily(family);
        List<String> list = new ArrayList<>();
        if (base == null || base.isBlank()) return list;

        list.add("ALL");
        list.add(base);
        list.add(base + A);
        list.add(base + B);
        return list;
    }
}
