
package com.shmamsa.repository;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceStatus;
import com.shmamsa.model.AttendanceType;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

public interface AttendanceRepository extends JpaRepository<AttendanceRecord, Long> {
    boolean existsByUser_IdAndDateAndType(Long userId, LocalDate date, AttendanceType type);

    AttendanceRecord findFirstByUser_IdAndDateAndType(Long userId, LocalDate date, AttendanceType type);
    List<AttendanceRecord> findByUser_IdOrderByCreatedAtDesc(Long userId);
    List<AttendanceRecord> findByUser_IdAndTypeOrderByCreatedAtDesc(Long userId, AttendanceType type);
    List<AttendanceRecord> findByUser_DeaconFamily(String deaconFamily);
    List<AttendanceRecord> findByDateAndType(LocalDate date, AttendanceType type);
    List<AttendanceRecord> findByUser_DeaconFamilyStartingWith(String prefix);

    long countByUser_IdAndType(Long userId, AttendanceType type);
    long countByUser_IdAndTypeAndStatus(Long userId, AttendanceType type, AttendanceStatus status);

    @Query("select count(a) from AttendanceRecord a where a.user.id = :userId and a.type = :type and (a.status is null or a.status = com.shmamsa.model.AttendanceStatus.PRESENT)")
    long countPresentByUserAndType(@Param("userId") Long userId, @Param("type") AttendanceType type);
    @Modifying
    @Transactional
    @Query("delete from AttendanceRecord a where a.user.id = :userId")
    int deleteByUserId(@Param("userId") Long userId);;

    /**
     * Delete attendance records where the given user is either the attended user or the taker.
     * Needed before deleting a user account to avoid FK constraints.
     */
    @Modifying
    @Transactional
    @Query("delete from AttendanceRecord a where a.user.id = :userId or (a.takenBy is not null and a.takenBy.id = :userId)")
    int deleteByUserOrTakenBy(@Param("userId") Long userId);

    @Modifying
    @Transactional
    @Query("delete from AttendanceRecord a where a.user.id in :userIds")
    int deleteByUserIds(@Param("userIds") List<Long> userIds);


    // ====== Active (غير مؤرشف) ======
    boolean existsByUser_IdAndDateAndTypeAndArchivedFalse(Long userId, LocalDate date, AttendanceType type);

    AttendanceRecord findFirstByUser_IdAndDateAndTypeAndArchivedFalse(Long userId, LocalDate date, AttendanceType type);


// ✅ FAMILY_MEETING is scoped by familyBase (for multi-family servants)
AttendanceRecord findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(Long userId, LocalDate date, AttendanceType type, String familyBase);

long countByUser_IdAndTypeAndFamilyBaseAndArchivedFalse(Long userId, AttendanceType type, String familyBase);


    List<AttendanceRecord> findByUser_IdAndArchivedFalseOrderByCreatedAtDesc(Long userId);

    List<AttendanceRecord> findByUser_IdAndTypeAndArchivedFalseOrderByCreatedAtDesc(Long userId, AttendanceType type);

    List<AttendanceRecord> findByUser_DeaconFamilyAndArchivedFalse(String deaconFamily);

    List<AttendanceRecord> findByDateAndTypeAndArchivedFalse(LocalDate date, AttendanceType type);

    List<AttendanceRecord> findByUser_DeaconFamilyStartingWithAndArchivedFalse(String prefix);

    long countByUser_IdAndTypeAndArchivedFalse(Long userId, AttendanceType type);

    @Query("select count(a) from AttendanceRecord a where a.archived = false and a.user.id = :userId and a.type = :type and (a.status is null or a.status = com.shmamsa.model.AttendanceStatus.PRESENT)")
    long countPresentByUserAndTypeActive(@Param("userId") Long userId, @Param("type") AttendanceType type);

    // أرشفة سجل الحضور (بدل الحذف) وربطه بالأرشيف
    @Modifying
    @Transactional
    @Query("update AttendanceRecord a set a.archived = true, a.archive = :archive where a.archived = false and a.user.id in :userIds")
    int archiveByUserIds(@Param("userIds") List<Long> userIds, @Param("archive") com.shmamsa.model.AttendanceArchive archive);

    // تحميل السجلات غير المؤرشفة لمجموعة مستخدمين
    List<AttendanceRecord> findByUser_IdInAndArchivedFalse(List<Long> userIds);

}
