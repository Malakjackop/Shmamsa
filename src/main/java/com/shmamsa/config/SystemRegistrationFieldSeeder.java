package com.shmamsa.config;

import com.shmamsa.model.CustomRegistrationField;
import com.shmamsa.repository.CustomRegistrationFieldRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
@RequiredArgsConstructor
public class SystemRegistrationFieldSeeder implements CommandLineRunner {

    private final CustomRegistrationFieldRepository fieldRepository;
    private static final Map<String, String> DEFAULT_SELECT_OPTIONS = buildDefaultSelectOptions();
    private static final Set<String> DEFAULT_PROFILE_EDITABLE_FIELDS = Set.of(
            "email",
            "phoneNumber",
            "address",
            "guardiansPhone",
            "guardianRelation",
            "schoolName",
            "schoolGrade",
            "universityName",
            "faculty",
            "universityGrade",
            "graduatedFrom",
            "graduateJob",
            "workDetails"
    );

    @Override
    @Transactional
    public void run(String... args) {
        if (fieldRepository.countByIsSystemTrue() > 0) {
            backfillMissingSystemSelectOptions();
            backfillWorkDetailsVisibility();
            return;
        }

        int order = 1;

        createSystemField("fullName", "الاسم بالكامل بالعربي", "TEXT", true, order++);
        createSystemField("username", "اسم المستخدم", "TEXT", true, order++);
        createSystemField("phoneNumber", "رقم الهاتف", "TEXT", false, order++);
        createSystemField("address", "العنوان", "TEXT", false, order++);
        createSystemField("nationalId", "الرقم القومي", "TEXT", false, order++);
        createSystemField("email", "البريد الإلكتروني", "TEXT", true, order++);
        createSystemField("dateOfBirth", "تاريخ الميلاد", "TEXT", false, order++);
        createSystemField("gender", "النوع", "TEXT", false, order++);
        
        createSystemField("deaconDegree", "رتبة الشماس", "SELECT", true, order++);
        createSystemField("deaconFamily", "الأسرة", "SELECT", false, order++);
        createSystemField("khors", "الخورس", "SELECT", false, order++);
        createSystemField("servingWhere", "بتخدم فين", "SELECT", false, order++);
        createSystemField("attendKhors", "خورس الحضور", "SELECT", false, order++);
        
        createSystemField("status", "الحالة (طالب/خريج)", "SELECT", false, order++);
        
        createSystemField("graduatedFrom", "الجامعة المتخرج منها", "TEXT", false, order++);
        createSystemField("graduateJob", "الوظيفة الحالية", "TEXT", false, order++);
        
        createSystemField("studyType", "الجهة الدراسية", "SELECT", false, order++);
        createSystemField("schoolName", "اسم المدرسة", "TEXT", false, order++);
        createSystemField("schoolGrade", "الصف الدراسي", "SELECT", false, order++);
        createSystemField("otherGrade", "صف دراسي آخر", "TEXT", false, order++);
        
        createSystemField("universityName", "اسم الجامعة", "TEXT", false, order++);
        createSystemField("faculty", "الكلية", "TEXT", false, order++);
        createSystemField("universityGrade", "الفرقة الدراسية", "TEXT", false, order++);
        
        createSystemField("isWorking", "هل تعمل؟", "SELECT", false, order++);
        createSystemField("workDetails", "ما هي وظيفتك", "TEXT", false, order++);
        applyWorkDetailsVisibility();
        
        createSystemField("guardiansPhone", "هاتف ولي الأمر", "TEXT", true, order++);
        createSystemField("guardianRelation", "صلة القرابة", "TEXT", false, order++);

        List<CustomRegistrationField> existingCustoms = fieldRepository.findByIsSystemFalseOrderByDisplayOrderAsc();
        for (CustomRegistrationField f : existingCustoms) {
            f.setDisplayOrder(order++);
            fieldRepository.save(f);
        }
    }

    private void createSystemField(String key, String label, String type, boolean required, int order) {
        CustomRegistrationField field = CustomRegistrationField.builder()
                .fieldKey(key)
                .labelAr(label)
                .fieldType(type)
                .options("SELECT".equals(type) ? DEFAULT_SELECT_OPTIONS.getOrDefault(key, "") : null)
                .required(required)
                .isSystem(true)
                .displayOrder(order)
                .visibilityRule("ALWAYS")
                .showIn("NONE")
                .profileEditable(DEFAULT_PROFILE_EDITABLE_FIELDS.contains(key))
                .enabled(true)
                .build();
        fieldRepository.save(field);
    }

    private void applyWorkDetailsVisibility() {
        fieldRepository.findByFieldKey("workDetails").ifPresent(field -> {
            field.setVisibilityDependsOn("isWorking");
            field.setVisibilityDependsValues("true");
            fieldRepository.save(field);
        });
    }

    private void backfillWorkDetailsVisibility() {
        fieldRepository.findByFieldKey("workDetails").ifPresent(field -> {
            String currentDependsOn = field.getVisibilityDependsOn();
            String currentDependsValues = field.getVisibilityDependsValues();
            if (currentDependsOn != null && !currentDependsOn.isBlank()) {
                return;
            }
            if (currentDependsValues != null && !currentDependsValues.isBlank()) {
                return;
            }
            field.setVisibilityDependsOn("isWorking");
            field.setVisibilityDependsValues("true");
            fieldRepository.save(field);
        });
    }

    private void backfillMissingSystemSelectOptions() {
        for (Map.Entry<String, String> entry : DEFAULT_SELECT_OPTIONS.entrySet()) {
            fieldRepository.findByFieldKey(entry.getKey()).ifPresent(field -> {
                if (!Boolean.TRUE.equals(field.getIsSystem())) {
                    return;
                }
                if (!"SELECT".equalsIgnoreCase(field.getFieldType())) {
                    return;
                }
                String current = field.getOptions();
                if (current != null && !current.isBlank()) {
                    return;
                }
                field.setOptions(entry.getValue());
                fieldRepository.save(field);
            });
        }
    }

    private static Map<String, String> buildDefaultSelectOptions() {
        Map<String, String> defaults = new LinkedHashMap<>();
        defaults.put("deaconDegree", "مش مرشوم,ابصالتس,اغنسطس,ايبودياكون");
        defaults.put("khors", "MARMARKOS,ATHANASIUS,NONE");
        defaults.put("attendKhors", "MARMARKOS,ATHANASIUS,NONE");
        defaults.put("status", "student,graduate");
        defaults.put("studyType", "school,university");
        defaults.put("schoolGrade", "أولى ابتدائي,تانية ابتدائي,تالتة ابتدائي,رابعة ابتدائي,خامسة ابتدائي,سادسة ابتدائي,أولى إعدادي,تانية إعدادي,تالتة إعدادي,أولى ثانوي,تانية ثانوي,تالتة ثانوي,other");
        defaults.put("isWorking", "false,true");
        return defaults;
    }
}
